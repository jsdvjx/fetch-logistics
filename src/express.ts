import { Observable, of, zip, merge, concat } from 'rxjs';
import { RxRedis } from 'redis-observable';
import { map, mergeMap, tap, concatMap } from 'rxjs/operators';
import * as crypto from 'crypto';
import * as levenshtien from 'damerau-levenshtein';
import { TmHandler } from './handler/tm.handler';
import * as dayjs from 'dayjs';
export enum ExpressState {
  /**
   * 无效状态
   */
  UNACTIVE = -1,
  /**
   * 没有信息
   */
  NOTFOUND = 0,
  /**
   * 在途
   */
  TRANSIT = 1,
  /**
   * 待收货
   */
  PICKUP = 2,
  /**
   * 妥投
   */
  DELIVERED = 3,
  /**
   * 异常
   */
  EXCEPTION = 4,
  /**
   * 超期
   */
  EXPIRED = 5,
}
export interface ExpressProcess {
  time: Date;
  content: string;
}
interface LevenshteinResponse {
  steps: number;
  relative: number;
  similarity: number;
}
export interface ExpressInfo<T = any> {
  id: number;
  number: string;
  company: string;
  code: string;
  state: ExpressState;
  source_state: ExpressState;
  guess: boolean;
  data: ExpressProcess[];
  type: string;
  source: T;
  phone: string;
  last_request: number;
  md5: string;
  request_count: number;
  updated_at: Date;
  created_at: Date;
  delivery_time: Date;
}
export interface QueryParam {
  id: number;
  company: string;
  number: string;
  code: string;
  phone: string;
  delivery_time?: Date;
}
export interface SignTemplate {
  regex: RegExp[];
  code: string;
}
export interface ExpressCompanyCode {
  company: string;
  code: string;
}
export interface ExpressPolicy {
  type: 'white' | 'black' | 'none';
  codes: string[];
}

export interface ExpressHandlerOption<T extends Record<string, any>> {
  name: string;
  webhook?: boolean;
  weight?: number;
  rate?: number;
  max_count?: number;
  policy?: ExpressPolicy;
  conf: T;
  signTemplates?: SignTemplate[];
  expire?: number;
  diy_map?: ExpressCompanyCode[];
}
export abstract class IExpress<T extends Record<string, any> = any, P = any> {
  private redis: RxRedis;
  config: P;
  constructor(option: { redis: RxRedis; config: ExpressHandlerOption<P> }) {
    this.redis = option.redis;
    this.setConfig(option.config);
  }
  protected abstract diy_map: ExpressCompanyCode[];
  protected abstract expire: number = 3600 * 24 * 10;
  setConfig = (config: ExpressHandlerOption<P>) => {
    this.config = this.config || config.conf;
    this.webhook = config.webhook || this.webhook;
    this.weight = config.weight || this.weight;
    this.rate = config.rate || this.rate;
    this.max_count = config.max_count || this.max_count;
    this.checkList = config.policy ||
      this.checkList || { type: 'none', codes: [] };
    this.diy_map = config.diy_map;
    //this.signTemplates = config.signTemplates || this.signTemplates;
    this.expire = config.expire || this.expire;
  };
  getConfig = () => {
    return {
      conf: this.config,
      webhook: this.webhook,
      weight: this.weight,
      rate: this.rate,
      max_count: this.max_count,
      policy: this.checkList,
      signTemplates: this.signTemplates,
      expire: this.expire,
    } as ExpressHandlerOption<P>;
  };
  abstract name: string;
  webhook: boolean = false;
  abstract weight: number = 100;
  protected abstract rate: number = 0;
  protected abstract max_count: number = 200;
  protected abstract getState: (data: T) => ExpressState;
  protected abstract getProcess: (data: T) => ExpressProcess[];
  protected abstract fetch: (param: ExpressInfo<T>) => Observable<T>;
  protected abstract signTemplates: SignTemplate[];
  protected abstract _put: (
    param: ExpressInfo<T>,
  ) => Observable<ExpressInfo<T>>;
  protected abstract checkList: {
    type: 'white' | 'black' | 'none';
    codes: string[];
  };
  legal: (param: QueryParam) => boolean = (param) => {
    if (!this.check(param.code)) {
      return false;
    }
    const code = this.fixCode(param).code;
    return this.codes.has(code) && this.check(code);
  };
  private check = (code: string) => {
    switch (this.checkList.type) {
      case 'white':
        return this.checkList.codes.includes(code);
      case 'black':
        return !this.checkList.codes.includes(code);
      case 'none':
      default:
        return true;
    }
  };
  put = (param: QueryParam) => {
    return this.getCacheOrInit(param).pipe(
      mergeMap((info) => {
        if (info.request_count > 0) {
          return of(info);
        }
        return this._put(info).pipe(tap((i) => this.after_convert([i, i])));
      }),
    );
  };
  query = (param: QueryParam, force: boolean = false) => {
    if (!this.checkExNu(param)) {
      throw new Error(`${param.company},${param.number} illegal`);
    }
    return this.getCacheOrInit(this.fixCode(param)).pipe(
      mergeMap((info) => {
        console.log(JSON.stringify(info), 'QUERY_FL');
        if (info.state === ExpressState.DELIVERED) {
          return of(info);
        }
        if (info.request_count >= this.max_count && !force) {
          return of(info);
        }
        if (this.rate > Date.now() / 1000 - (info.last_request || 0)) {
          return of(info);
        }
        if (this.webhook && !force) {
          return of(this.after_convert(this.convert([info, info.source]))[0]);
        }
        console.log('REAL_QUERY', info.number, info.company);
        return this.fetch(info).pipe(
          mergeMap((source) => this.push(source, param)),
        );
      }),
    );
  };
  push = (source: T, param?: QueryParam) => {
    return zip(
      this.getCacheOrInit(param ? param : this.getParamByResponse(source)),
      of(source),
    ).pipe(
      map(this.convert),
      tap(this.after_convert),
      map(([result, _]) => result),
    );
  };
  private after_convert = ([last, pre]: [ExpressInfo<T>, ExpressInfo<T>]) => {
    last.request_count += 1;
    last.updated_at = new Date();
    last.last_request = Math.floor(last.updated_at.valueOf() / 1000);
    if (pre.state !== ExpressState.DELIVERED) {
      this.redis
        .set(this.getKey(last), JSON.stringify(last), 3600 * 24 * 10)
        .subscribe();
    }
  };
  protected abstract getParamByResponse: (source: T) => QueryParam;
  protected expired = (last_request: number) => {
    return last_request + this.rate <= Math.floor(Date.now() / 1000);
  };
  protected checkExNu = (param: QueryParam) => {
    const nu = param.number;
    const reg = /^[a-zA-Z0-9]{6,16}$/;
    const result = reg.test(nu);
    if (!result) console.error(`${param.company},${param.number}`, 'illegal');
    return result;
  };
  protected initExpressInfo: (param: QueryParam) => ExpressInfo<T> = (
    param,
  ) => {
    const now = new Date();
    const result = {
      ...param,
      state: ExpressState.UNACTIVE,
      source_state: ExpressState.UNACTIVE,
      guess: false,
      data: [],
      source: null,
      last_request: 0,
      type: this.name,
      md5: null,
      request_count: 0,
      created_at: now,
      updated_at: now,
    } as ExpressInfo<T>;
    return result;
  };
  getCacheOrInit = (param: QueryParam) => {
    const key = this.getKey(param);
    return this.redis.get(key).pipe(
      mergeMap((cache) => {
        if (cache === null) {
          return of(this.initExpressInfo(param));
        } else {
          return of(JSON.parse(cache) as ExpressInfo<T>);
        }
      }),
    );
  };
  private getKey = (param: { code: string; number: string }) => {
    return `EXPRESS_CACHE_${this.name}_${param.code}_${param.number}`;
  };
  private convert = ([container, source]: [ExpressInfo<T>, T]): [
    ExpressInfo<T>,
    ExpressInfo<T>,
  ] => {
    const _state = this.getState(source);
    const data = this.getProcess(source).sort(
      (a, b) => dayjs(b.time).valueOf() - dayjs(a.time).valueOf(),
    );
    const guess = this.guess_sign(data, container.code);
    const request_count = container.request_count;
    const now = new Date();
    const state =
      _state !== ExpressState.DELIVERED && guess
        ? ExpressState.DELIVERED
        : _state;
    const md5 = this.getMd5(data, state);
    const source_state = _state;
    return [
      {
        ...container,
        data,
        state,
        source_state,
        guess,
        source,
        md5,
        request_count,
        updated_at: now,
      },
      container,
    ];
  };
  private getMd5 = (last: ExpressProcess[], state: ExpressState) => {
    return crypto
      .createHash('md5')
      .update(last.map((i) => i.time.toISOString()).join('') + '_' + state)
      .digest('hex');
  };
  protected levenshtien: (
    p1: string,
    p2: string,
  ) => LevenshteinResponse = levenshtien;
  private guess_sign = (process: ExpressProcess[], code: string) => {
    const lastInfo = process[0];
    if (!lastInfo) {
      return false;
    }
    if (dayjs(lastInfo.time).add(1, 'd').isAfter(dayjs())) {
      return false;
    }
    for (const template of this.signTemplates) {
      if (template.code === code) {
        for (const reg of template.regex) {
          if (reg.test(lastInfo.content)) {
            return true;
          }
        }
      }
    }
    return false;
  };
  protected abstract initCode: () => Observable<ExpressCompanyCode[]>;
  codeMap: ExpressCompanyCode[] = null;
  codes: Set<string>;
  protected abstract _init?: () => Observable<any>;
  init = () => {
    return (this._init || (() => of(null)))().pipe(
      mergeMap(this.initCode),
      tap((codeMap) => {
        this.codeMap = codeMap;
        this.codes = new Set(this.codeMap.map((i) => i.code));
      }),
      map(() => this),
    );
  };
  protected fixCode = (param: QueryParam) => {
    if (this.codes.has(param.code)) return param;
    for (const i of this.diy_map || []) {
      if (param.company === i.company) {
        param.code = i.code;
        return param;
      }
    }
    const code = this.codeMap
      .map((tmp) => {
        const step =
          this.levenshtien(tmp.code, param.code || '').steps +
          this.levenshtien(tmp.company, param.company).steps;
        return { ...tmp, step };
      })
      .sort((a, b) => b.step - a.step)
      .pop();
    return { ...param, ...code } as QueryParam;
  };
}
