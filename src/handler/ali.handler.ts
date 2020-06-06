import {
  IExpress,
  ExpressState,
  ExpressProcess,
  ExpressInfo,
  SignTemplate,
  QueryParam,
  ExpressCompanyCode,
  ExpressHandlerOption,
} from '../express';
import { Observable, of, from } from 'rxjs';
import * as querystring from 'querystring';
import axios, { AxiosRequestConfig } from 'axios';
import { map } from 'rxjs/operators';
interface AliExpressResponse {
  no: string;
  code: string;
  type: string;
  list: { time: string; content: string }[];
  state: ExpressState;
  msg: string;
  name: string;
  site: string;
  log: string;
  phone: string;
  courier: string;
  courierPhone: string;
}
export class AliHandler<
  O extends { appCode: string } = { appCode: string }
> extends IExpress<AliExpressResponse, O> {
  protected put: (
    param: ExpressInfo<AliExpressResponse>,
  ) => Observable<ExpressInfo<AliExpressResponse>>;
  protected expire: number = 3600 * 24 * 10;
  protected checkList: { type: 'white' | 'black' | 'none'; codes: string[] };
  protected _init?: () => Observable<any>;
  name: string = 'ALI';
  webhook: boolean = false;
  weight = 100;
  protected rate: number = 3600;
  protected max_count: number = 120;
  protected getState: (data: AliExpressResponse) => ExpressState = data =>
    data.state || ExpressState.UNACTIVE;
  protected getProcess: (
    data: AliExpressResponse,
  ) => ExpressProcess[] = input =>
    (input.list || []).map(i => ({
      time: new Date(i.time),
      content: i.content,
    }));
  private baseUrl = 'https://cexpress.market.alicloudapi.com/';
  protected fetch: (
    param: ExpressInfo<AliExpressResponse>,
  ) => Observable<AliExpressResponse> = (param: QueryParam) => {
    const task = param;
    const url = `${this.baseUrl}cexpress?${querystring.stringify({
      no:
        task.code === 'SF'
          ? `${task.number}:${task.phone.substr(task.phone.length - 4, 4)}`
          : task.number,
      type: task.code,
    })}`;
    return this.request(url);
  };
  protected request = (
    url: string,
    header: AxiosRequestConfig['headers'] = {},
  ) => {
    return from(
      axios
        .get(url, {
          responseType: 'text',
          headers: {
            ...header,
            Authorization: `APPCODE ${this.config.appCode}`,
          },
        })
        .then(i => i.data),
    );
  };
  protected signTemplates: SignTemplate[] = [];
  protected getParamByResponse: (source: AliExpressResponse) => QueryParam;
  static getCreator = () => {};
  protected initCode: () => Observable<ExpressCompanyCode[]> = () => {
    const url = `${this.baseUrl}cExpressLists`;
    return this.request(url).pipe(
      map(tmp => tmp.result),
      map((items: Record<string, string>) => {
        return Object.entries(items).map(([code, company]) => ({
          code,
          company,
        }));
      }),
    );
  };
}
