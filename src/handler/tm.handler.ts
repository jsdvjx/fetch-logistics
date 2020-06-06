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
import { pluck, map, mergeMap } from 'rxjs/operators';
export class TmHandler<
  O extends { apiKey: string } = { apiKey: string }
> extends IExpress<WebhookBody, O> {
  protected put: (
    param: ExpressInfo<WebhookBody>,
  ) => Observable<ExpressInfo<WebhookBody>> = param => {
    return this.tm
      .createTracking({
        tracking_number: param.number,
        carrier_code: param.code as any,
      })
      .pipe(mergeMap(i => of(param)));
  };
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
          customer_email: (info.customer_email || [null])[0],
        } as WebhookBody)
      : null;
  };
  protected signTemplates: SignTemplate[] = [
    {
      regex: [/派件送达【.+?】.+?，请前往.+?领取您的包裹，联系电话：[\d-]+/],
      code: 'bestex',
    },
    {
      regex: [
        /快件已在 【.+?】 签收, 签收人:.+? 如有疑问请电联:.+?, 您的快递已经妥投。风里来雨里去, 只为客官您满意。上有老下有小, 赏个好评好不好？【请在评价快递员处帮忙点亮五颗星星哦~】/,
        /快件已送达【.+?】, 如有问题请电联.+?感谢.*?使用中通快递, 期待再次为您服务!/,
      ],
      code: 'zto',
    },
    {
      regex: [
        /【.+?】.+? 快递员 .+?\d+? 正在为您派件【.+?为韵达快递员外呼专属号码，请放心接听】/,
      ],
      code: 'yunda',
    },
    {
      regex: [/快件已[由被].+?.+?，请及时取件[。，].+请联系\d+/],
      code: 'sto',
    },
    {
      regex: [/邮件投递到.+?,投递员:.+?,电话:.+?/],
      code: 'ems',
    },
  ];
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
