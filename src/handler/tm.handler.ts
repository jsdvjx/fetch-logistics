import {
  IExpress,
  ExpressState,
  ExpressProcess,
  ExpressInfo,
  SignTemplate,
  QueryParam,
  ExpressCompanyCode,
} from '../express';
import {
  TrackingMoreApi,
  WebhookBody,
  TrackingInformation,
} from 'trackingmore';
import { Observable, of } from 'rxjs';
import { pluck, map } from 'rxjs/operators';
export class TmHandler<
  O extends { apiKey: string } = { apiKey: string }
> extends IExpress<WebhookBody, O> {
  protected expire: number = 3600 * 24 * 10;
  protected checkList: { type: 'white' | 'black' | 'none'; codes: string[] } = {
    type: 'black',
    codes: ['sf-express'],
  };
  private tm: TrackingMoreApi;
  protected _init?: () => Observable<any> = () => {
    this.tm = new TrackingMoreApi(this.config.apiKey);
    return of(this.tm);
  };
  name: string = 'TM';
  weight = 0;
  protected rate: number = 0;
  protected max_count: number = 1;
  protected getState: (data: WebhookBody) => ExpressState = task => {
    switch (task.status) {
      case 'delivered':
        return ExpressState.DELIVERED;
      case 'notfound':
      case 'pending':
        return ExpressState.NOTFOUND;
      case 'pickup':
        return ExpressState.PICKUP;
      case 'transit':
        return ExpressState.TRANSIT;
      case 'exception':
        return ExpressState.EXCEPTION;
      case 'undelivered':
      case 'expired':
      default:
        return ExpressState.EXPIRED;
    }
  };
  protected getProcess: (data: WebhookBody) => ExpressProcess[] = item => {
    if (!item || !item.origin_info || !item.origin_info.trackinfo) {
      return [] as ExpressProcess[];
    }
    return item.origin_info.trackinfo.map(item => ({
      time: new Date(item.Date),
      content: item.StatusDescription,
    }));
  };
  protected fetch: (
    param: ExpressInfo<WebhookBody>,
  ) => Observable<WebhookBody> = param => {
    return this.tm
      .getTracking({
        tracking_number: param.number,
        carrier_code: param.code as any,
      })
      .pipe(
        map(i => {
          return i.data.data;
        }),
        map(this.info2body),
      );
  };
  private info2body: (info: TrackingInformation) => WebhookBody = info => {
    return info
      ? ({
          ...info,
          customer_email: info.customer_email[0],
        } as WebhookBody)
      : null;
  };
  protected signTemplates: SignTemplate[] = [];
  protected getParamByResponse: (
    source: WebhookBody,
  ) => QueryParam = source => {
    for (const code of this.codeMap) {
      if (code.code === source.carrier_code) {
        return {
          id: -1,
          company: code.company,
          number: source.tracking_number,
          code: code.code,
          phone: '',
          delivery_time: new Date(source.created_at),
        };
      }
    }
    return null;
  };
  protected initCode: () => Observable<ExpressCompanyCode[]> = () => {
    return this.tm.carriers().pipe(
      pluck('data'),
      map(i => {
        return i.data.map(item => ({ company: item.name, code: item.code }));
      }),
    );
  };
}
