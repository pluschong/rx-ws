import { SafeAny } from '@pluschong/safe-type';
import { interval, Observable, Subject, Subscription } from 'rxjs';
import { decodeMsg, encodeMsg } from './enigma';
import { logger } from './log';
import {
	Cfg,
	Interceptors,
	ObeMapValue,
	ReqData,
	RspMsgBody,
	UseOptionCfg,
	UseReqDefParam,
	UseRspErrMsg,
	WsKey,
	WsNotify,
	WsOptions,
	WsSeqNo,
	WsStatus
} from './websocket.type';

class WebsocketService {
	static instance: WebsocketService;
	static getInstance() {
		if (!this.instance) {
			this.instance = new WebsocketService();
		}
		return this.instance;
	}

	private ws: WebSocket | null = null;
	private reconnectPeriod = 3 * 1000; // 重连周期
	private reconnectSubscription: Subscription = new Observable().subscribe();
	private checkingPeriod = 3 * 1000; // 检查周期
	private checkingSubscription: Subscription = new Observable().subscribe();
	private seqNoBase = 999;
	private timeout = 15 * 1000;

	private message$;
	private error$;
	private mapReq: Map<WsSeqNo, ObeMapValue> = new Map();
	private mapInd: Map<WsKey, Subject<RspMsgBody>> = new Map(); // 推送主题集合
	private mapIndObs: Map<string, Observable<RspMsgBody>> = new Map(); // 推送可观察集合
	private undo: Map<WsSeqNo, { reqWsKey: WsKey; data?: ReqData }> = new Map(); // 因为ws未连接，导致未发出的请求
	private disconnectOptions = {
		/** 重连倒计时 */
		second: 25
	};

	/**
	 * 默认参数 和 错误消息拦截
	 */
	private interceptorsFuns: {
		options: UseOptionCfg;
		request: UseReqDefParam;
		response: UseRspErrMsg;
	};
	private config: Cfg;

	/** 是否连接 */
	isConnected = false;
	/** 是否重新连接中... */
	isReconnecting = false;
	/** 主动关闭 */
	isClose = false;
	/**
	 * 断开连接状态
	 *
	 * `0` 正常断开，需要重连
	 * `1` 异地登录，无需重连
	 */
	status: WsStatus = 0;

	constructor() {
		this.message$ = new Subject<WsNotify>();
		this.error$ = new Subject<{ errMsg: string; body?: RspMsgBody }>();
		this.interceptorsFuns = {
			options: () => ({}),
			request: () => ({}),
			response: () => ''
		};
		this.config = {
			wsUrl: '',
			login: {
				reqWsKey: 0
			},
			keepAlive: {
				reqWsKey: 0
			},
			token: () => '',
			isGuest: () => false
		};
	}

	private get seqNo(): WsSeqNo {
		this.seqNoBase = ++this.seqNoBase > 60000 ? 1000 : this.seqNoBase;
		return this.seqNoBase;
	}

	/**
	 * 通知信息 如: 连接成功、登录成功等
	 */
	get notifyObs() {
		return this.message$.asObservable();
	}

	/**
	 * 错误信息 如: 接口报错等
	 */
	get errorObs() {
		return this.error$.asObservable();
	}

	/**
	 * 后端推送过来的订阅消息集合
	 */
	get messageObs() {
		return this.mapIndObs;
	}

	/** 检查是否需要重连 */
	get checkNeedReconnect() {
		return this.status !== 1;
	}

	get interceptors(): Interceptors {
		return {
			options: fun => {
				this.interceptorsFuns.options = fun;
			},
			request: fun => {
				this.interceptorsFuns.request = fun;
			},
			response: fun => {
				this.interceptorsFuns.response = fun;
			}
		};
	}

	/** 检查是否链接 `true`已链接 */
	checkConnectState() {
		if (!this.ws) return false;
		if (this.ws.readyState !== this.ws.OPEN) return false;
		return true;
	}

	/** 连接 */
	connect(url: string = '') {
		this.config.wsUrl = url || this.config.wsUrl;

		logger('[ws connect] --> 准备连接', this.config.wsUrl);
		if (this.config.wsUrl) this.createWebSocket();
	}

	/** 断开连接 */
	close() {
		if (this.ws) {
			logger('[ws close] --> 主动断连');

			this.isClose = true;
			this.ws.close(3001, 'logout');
		}
	}

	/** 设置状态 */
	setStatus(status: WsStatus) {
		this.status = status;
	}

	/** 设置配置参数 */
	setConfig(cfg: Cfg) {
		this.config = { ...this.config, ...cfg };
	}

	/** 设置主动推送订阅 */
	setPushSub(pushItems: { [key: string]: number }) {
		new Map<string, number>(Object.entries(pushItems) as SafeAny).forEach((wsKey, name) => {
			const subject$ = new Subject<SafeAny>();
			this.mapInd.set(wsKey, subject$);
			this.mapIndObs.set(name, subject$.asObservable());
		});
	}

	/** 发消息 */
	sendMessage(options: WsOptions, data?: ReqData): Observable<RspMsgBody> {
		if (options.filterGuest && this.config.isGuest()) {
			return new Observable(subscribe => {
				logger(`[ws req][访客过滤] --> ${options.reqWsKey} -->「${new Date().getTime()}」`, data);
				subscribe.error({
					wsKey: options.reqWsKey,
					err_code: 110119120,
					err_desc: '游客过滤'
				});
			});
		}
		const currSeqNo = this.seqNo;
		const defaultParam = this.interceptorsFuns.request();
		return this.sendBefore(
			currSeqNo,
			{ ...this.interceptorsFuns.options(), ...options },
			{ ...(data || {}), ...(defaultParam || {}) }
		);
	}

	/** 执行在ws连接后，需要重发的 */
	checkUndo() {
		this.undo.forEach(({ data }, seqNo) => {
			this.deleteUndo(seqNo);
			const obeValue = this.getObeValue(seqNo);
			if (obeValue && obeValue.options.isUndo) {
				this.send(seqNo, obeValue.options, data, true);
			}
		});
	}

	private getObeValue(seqNo: number) {
		return this.mapReq.get(seqNo);
	}

	private getPushSub(rspWsKey: WsKey) {
		return this.mapInd.get(rspWsKey);
	}

	private getUndo(seqNo: WsSeqNo) {
		return this.undo.get(seqNo);
	}

	private delObeValue(seqNo: number) {
		this.mapReq.delete(seqNo);
	}

	private deleteUndo(seqNo: WsSeqNo) {
		this.undo.delete(seqNo);
	}

	private setUndo(seqNo: number, reqWsKey: number, data?: ReqData) {
		const previous = this.getUndo(seqNo);
		// undo存在相同的请求，结束上次未完成的请求，然后再存储此次新的请求
		if (previous && previous.reqWsKey === reqWsKey) {
			this.timeoutFun(seqNo);
		}
		this.undo.set(seqNo, { reqWsKey, data });
	}

	private timeoutFun(seqNo: number) {
		const obeValue = this.getObeValue(seqNo);

		if (obeValue) {
			clearTimeout(obeValue.timeoutTimer);
			this.deleteUndo(seqNo);
			this.delObeValue(seqNo);

			const { reqWsKey, rspWsKey } = obeValue.options;
			const errMsg = this.interceptorsFuns.response({ err_code: -1000 }, obeValue.options); // 自定义错误
			const body = {
				reqWsKey,
				rspWsKey,
				err_code: 2,
				err_desc: 'custom timeout'
			};
			obeValue.subject$.error(body);
			this.error$.next({ errMsg, body });
			logger(`[ws rsp 超时][${seqNo}] --> ${rspWsKey} -->「${new Date().getTime()}」`, { body });
		}
	}

	private sendBefore(seqNo: number, options: WsOptions, data?: ReqData): Observable<RspMsgBody> {
		const { reqWsKey, ignore, timeout, isUndo } = options;
		const subject$ = new Subject<SafeAny>();

		if (ignore) {
			// 不关心响应直接完成主题
			subject$.complete();
		} else {
			// 超时未响应，结束订阅
			const timeoutTimer = setTimeout(() => this.timeoutFun(seqNo), timeout || this.timeout);
			this.mapReq.set(seqNo, { options, subject$, timeoutTimer });
		}

		// TODO:发送请求
		const sended = this.send(seqNo, options, data);
		if (!sended && isUndo) {
			this.setUndo(seqNo, reqWsKey, data);
		}

		return subject$.asObservable();
	}

	private send(
		seqNo: number,
		{ reqWsKey, isConsoleInvisible }: WsOptions,
		data?: ReqData,
		retry?: boolean
	): boolean {
		if (this.ws && this.ws.readyState === 1 && this.isConnected) {
			if (!isConsoleInvisible) {
				logger(
					`[ws req][${seqNo}] --> ${reqWsKey} ${retry ? '---------- 重发' : ''} -->「${new Date().getTime()}」`,
					data
				);
			}

			try {
				this.ws.send(encodeMsg(seqNo, reqWsKey, data));
			} catch (error) {
				logger('[ws error] --> sendMessage', error);
			}

			return true;
		}

		if (!isConsoleInvisible) {
			logger(`[ws req][${seqNo}] --> ${reqWsKey} ---------- 请求没有发出，因为ws未连接`, data);
		}

		return false;
	}

	/** 创建ws */
	private createWebSocket() {
		this.ws = new WebSocket(this.config.wsUrl);
		this.ws.binaryType = 'arraybuffer';
		this.ws.onopen = event => this.onOpen(event);
		this.ws.onclose = event => this.onClose(event);
		this.ws.onerror = event => this.onError(event);
		this.ws.onmessage = event => this.onMessage(event);
	}

	/** OPENED `当前连接已经准备好发送和接受数据` */
	private onOpen(event: Event) {
		logger('[ws open] --> 已连接', event);

		this.isConnected = true;
		this.isClose = false;
		this.wsCancelReconnect();
		this.wsCheckHeart();

		// TODO:推送连接成功消息
		this.message$.next({ type: 'opened' });

		// TODO:登录WS
		this.sendMessage(this.config.login, {
			digest: this.config.token()
		}).subscribe({
			next: () => {
				// TODO:推送登录成功消息
				this.message$.next({ type: 'logined' });
			},
			error: err => {
				// TODO:推送登录失败消息
				this.message$.next({ type: 'loginFailure', value: err });
			}
		});
	}

	/** CLOSED `当websocket的连接状态readyState 变为 CLOSED时被调用` */
	private onClose(event: Event) {
		logger('[ws close] --> 断开连接', event);

		this.isConnected = false;
		this.ws!.close();
		this.wsCancelCheckHeart();
		this.wsReconnect();
	}

	/** ERROR `发生错误时执行的回调函数` */
	private onError(event: Event) {
		logger('[ws error] --> onError', event);

		this.isConnected = false;
	}

	/** 收到服务器消息 */
	private onMessage(event: MessageEvent) {
		// TODO:响应的消息
		const data = decodeMsg(event.data as ArrayBuffer);

		if (data) {
			const { seqNo, wsKey, body } = data;
			const obeValue = this.getObeValue(seqNo);
			const pushSub = this.getPushSub(wsKey);

			if (
				(obeValue && !obeValue.options.ignore && !obeValue.options.isConsoleInvisible) ||
				pushSub
			) {
				logger(`[ws rsp][${seqNo}] --> ${wsKey} -->「${new Date().getTime()}」`, data);
			}

			// 请求在map存在，通知订阅
			if (obeValue) {
				// wsKey 应与 rspWsKey 相同
				const { subject$, options } = obeValue;

				if (body.err_code || body.err_desc) {
					const errMsg = this.interceptorsFuns.response(body, options); // 自定义错误提示
					this.error$.next({ errMsg, body: { ...body, wsKey } });
					subject$.error(body);
				} else {
					subject$.next(body);
					subject$.complete();
				}

				subject$.unsubscribe();
				this.delObeValue(seqNo);
			}

			// 推送订阅中存在，更新订阅
			if (pushSub) {
				pushSub.next(body);
			}
		}
	}

	/** 检测心跳 */
	private wsCheckHeart() {
		this.checkingSubscription = interval(this.checkingPeriod).subscribe(() => {
			if (this.ws && this.ws.readyState === 1) {
				this.sendMessage(this.config.keepAlive);
				return;
			}

			logger('[ws] --> 连接断开,准备重连...');

			this.wsCancelCheckHeart();
			this.wsReconnect();
		});
	}

	/** 停止检测心跳 */
	private wsCancelCheckHeart() {
		this.checkingSubscription.unsubscribe();
	}

	/** 重连 */
	private wsReconnect() {
		if (this.isConnected) {
			this.wsCancelReconnect();
			return;
		}
		if (this.isClose) return;
		if (this.isReconnecting) return;

		this.isReconnecting = true;
		this.reconnectSubscription = interval(this.reconnectPeriod).subscribe(count => {
			const _count = ++count;
			if (
				this.checkNeedReconnect &&
				(this.reconnectPeriod * _count) / 1000 < this.disconnectOptions.second
			) {
				logger(`[ws] --> 重连:${_count}次`);

				this.connect();
			} else {
				this.wsCancelReconnect();
			}
		});

		// 重连提示
		setTimeout(() => {
			if (this.checkNeedReconnect) {
				this.message$.next({ type: 'reconnect', value: this.disconnectOptions.second });
			}
		}, this.reconnectPeriod);
	}

	/** 取消重连 */
	private wsCancelReconnect() {
		this.isReconnecting = false;
		this.reconnectSubscription.unsubscribe();
	}
}

export const wsSrv = WebsocketService.getInstance();
