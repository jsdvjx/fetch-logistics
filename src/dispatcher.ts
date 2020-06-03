import {
  IExpress,
  QueryParam,
  ExpressInfo,
  ExpressHandlerOption,
} from './express';
import { of, Observable } from 'rxjs';
import { RxRedis } from 'redis-observable';
import * as redis from 'redis';
import { AliHandler } from './handler/ali.handler';
import { TmHandler } from './handler/tm.handler';
export interface ExpressCreator<I extends IExpress<any, T>, T = I['config']> {
  creator: new (option: { redis: RxRedis; config: T }) => I;
  option: T;
}
export class Dispatcher {
  private handlers: IExpress[];
  private constructor(...handlers: IExpress[]) {
    this.handlers = handlers.sort((a, b) => a.weight - b.weight);
  }
  private static redis: RxRedis;
  private static instance: Dispatcher;
  static create = (
    redisOpt: redis.ClientOpts,
    ...args: ExpressCreator<AliHandler | TmHandler>[]
  ) => {
    if (Dispatcher.instance) {
      return Dispatcher.instance;
    }
    if (!Dispatcher.redis) {
      Dispatcher.redis = new RxRedis(redisOpt);
    }
    const handler: IExpress[] = [];
    for (const pack of args) {
      handler.push(
        new pack.creator({ redis: Dispatcher.redis, config: pack.option }),
      );
    }
    Dispatcher.instance = new Dispatcher(...handler);
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
  query = (
    param: QueryParam,
    handler_name: string = null,
    force: boolean = true,
  ) => {
    const handler = this.chose(param, handler_name);
    return (handler
      ? (force ? handler.query : handler.getCacheOrInit)(param, force)
      : of(null)) as Observable<ExpressInfo<any>>;
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
