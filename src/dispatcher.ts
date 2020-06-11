import {
  IExpress,
  QueryParam,
  ExpressInfo,
  ExpressHandlerOption,
} from './express';
import { of, Observable } from 'rxjs';
import { RxRedis } from 'redis-observable';
import * as redis from 'redis';
export type ExpressCreator = {
  new (option: { redis: RxRedis; config: ExpressHandlerOption<any> }): IExpress<
    any,
    any
  >;
};
export type ExpressOption<O> = O extends {
  new (option: { redis: RxRedis; config: infer X }): IExpress<any, any>;
}
  ? X
  : any;
export class Dispatcher {
  private handlers: IExpress[] = [];
  private constructor() {}
  private static redis: RxRedis;
  private static instance: Dispatcher;
  static register = async <P extends ExpressCreator>(
    creator: P,
    config: ExpressOption<P>,
  ) => {
    if (!Dispatcher.instance) {
      throw new Error('Must create a Dispatcher instance');
    }
    for (const handler of Dispatcher.instance.handlers) {
      if (handler.name === config.name) {
        handler.setConfig(config);
        return;
      }
    }
    const handler = new creator({ redis: Dispatcher.redis, config });
    await handler.init().toPromise();
    Dispatcher.instance.handlers.push(handler);
    Dispatcher.instance.handlers = Dispatcher.instance.handlers.sort(
      (a, b) => b.weight - a.weight,
    );
    return;
  };
  static create = (redisOpt: redis.ClientOpts | RxRedis) => {
    if (Dispatcher.instance) {
      return Dispatcher.instance;
    }
    if (!Dispatcher.redis) {
      Dispatcher.redis =
        redisOpt instanceof RxRedis ? redisOpt : new RxRedis(redisOpt);
    }
    Dispatcher.instance = new Dispatcher();
    return Dispatcher.instance;
  };
  private chose = (param: QueryParam, handler_name: string = null) => {
    for (const handler of this.handlers) {
      if (
        handler.legal(param) &&
        (handler_name ? handler.name === handler_name : true)
      ) {
        return handler;
      }
    }
    return null;
  };
  push = <T>(source: T, handler_name: string) => {
    return (
      this.getHandler(handler_name) || {
        push: () => of(null as ExpressInfo<T>),
      }
    ).push(source);
  };
  query = (
    param: QueryParam,
    force: boolean = true,
    handler_name: string = null,
  ) => {
    const handler = this.chose(param, handler_name);
    if (!handler) {
      console.error('HANDLER NOT FOUND', JSON.stringify(param));
      return of(null);
    }
    if (handler.webhook && !force) {
      return handler.put(param);
    }
    return (force ? handler.query : handler.getCacheOrInit)(
      param,
      force,
    ) as Observable<ExpressInfo<any>>;
  };
  getHandlerName = () => {
    return this.handlers.map(i => i.name);
  };
  getHandler = (handler_name: string) => {
    for (const handler of this.handlers) {
      if (handler.name === handler_name) {
        return handler;
      }
    }
    return null;
  };
  getConfig = () => {
    return Object.fromEntries(this.handlers.map(i => [i.name, i.getConfig()]));
  };
  setConfig = (
    handler_name: string,
    option: Partial<ExpressHandlerOption<any>>,
  ) => {
    const handler = this.getHandler(handler_name);
    if (handler) {
      handler.setConfig(option as ExpressHandlerOption<any>);
      return handler.getConfig()[handler.name];
    }
    return null;
  };
}
