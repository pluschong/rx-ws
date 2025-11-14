import { SafeAny, SafeObject } from '@pluschong/safe-type';
import { Subject } from 'rxjs';

interface RspMsgPartCommon {
	err_code?: number;
	err_desc?: string;
}

/**
 * `0` 正常断开，需要重连
 * `1` 异地登录，无需重连
 */
export type WsStatus = 0 | 1;

/** ws原语 */
export type WsKey = number;

/** ws请求自定义编号 */
export type WsSeqNo = number;

/** ws请求入参 */
export interface ReqData {
	[key: string]: SafeAny;
}

export interface RspMsgBody extends RspMsgPartCommon {
	[key: string]: SafeAny;
}

/** ws请求出参 */
export interface RspData {
	seqNo: WsSeqNo;
	wsKey: WsKey;
	body: RspMsgBody;
}

/** ws请求订阅集合 */
export interface ObeMapValue {
	options: WsOptions;
	subject$: Subject<SafeAny>;
	timeoutTimer: SafeAny;
}

/** ws请求原语配置 */
export interface WsOptions {
	reqWsKey: WsKey;
	rspWsKey?: WsKey;
	/** 超时时间 毫秒 */
	timeout?: number;
	/** 不关心响应 */
	ignore?: boolean;
	/** 不打印入参出参 */
	isConsoleInvisible?: boolean;
	/** 不显示错误提示 */
	isErrorInvisible?: boolean;
	/** 当errCode符合要求时，不显示错误提示 */
	errCodeInvisible?: number;
	/** 如果ws未连接之前发送请求，当连接之后，重发一次 */
	isUndo?: boolean;
	/** 访客过滤，如果是访客不会调用该接口 */
	filterGuest?: boolean;
}

/** ws本身事件 */
export interface WsNotify {
	/**
	 * `opened` 已连接
	 * `logined` 已登录
	 * `closed` 已断开
	 * `reconnect` 重新连接
	 */
	type: 'opened' | 'logined' | 'closed' | 'reconnect' | 'loginFailure';
	value?: SafeAny;
}

export interface Cfg {
	wsUrl: string;
	login: WsOptions;
	keepAlive: WsOptions;
	token: () => string;
	isGuest: () => boolean;
}

export type UseOptionCfg = () => Omit<WsOptions, 'reqWsKey' | 'rspWsKey'>;
export type UseReqDefParam = () => SafeObject;
export type UseRspErrMsg = (value: RspMsgBody, options: WsOptions) => string;

export interface Interceptors {
	options: (fun: UseOptionCfg) => void;
	request: (fun: UseReqDefParam) => void;
	response: (fun: UseRspErrMsg) => void;
}

export declare interface ErrorCfg {
	msg: string;
	key: string;
}
