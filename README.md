# @pluschong/rx-ws

基于 RxJS 封装的 WebSocket 库，提供类型安全、自动重连、心跳检测等功能。

## 特性

- 🔄 自动重连机制
- 💓 心跳检测
- 🎯 基于 RxJS Observable 的响应式编程
- 📝 完整的 TypeScript 类型支持
- 🔌 请求/响应拦截器
- 📤 服务端推送订阅
- ⏱️ 请求超时控制
- 🔐 二进制消息编解码

## 安装

```bash
npm install @pluschong/rx-ws rxjs
```

```bash
pnpm add @pluschong/rx-ws rxjs
```

## 快速开始

### 基础配置

```typescript
import { wsSrv } from '@pluschong/rx-ws';

// 设置配置
wsSrv.setConfig({
  wsUrl: 'ws://localhost:8080',
  login: {
    reqWsKey: 1001,
    rspWsKey: 1001
  },
  keepAlive: {
    reqWsKey: 1002,
    rspWsKey: 1002
  },
  token: () => localStorage.getItem('token') || '',
  isGuest: () => !localStorage.getItem('token')
});

// 连接
wsSrv.connect();
```

### 发送消息

```typescript
wsSrv.sendMessage(
  {
    reqWsKey: 2001,
    rspWsKey: 2001
  },
  { userId: 123 }
).subscribe({
  next: (data) => {
    console.log('响应数据:', data);
  },
  error: (err) => {
    console.error('请求失败:', err);
  }
});
```

### 监听连接状态

```typescript
// 监听连接通知
wsSrv.notifyObs.subscribe(notify => {
  switch (notify.type) {
    case 'opened':
      console.log('WebSocket 已连接');
      break;
    case 'logined':
      console.log('登录成功');
      break;
    case 'reconnect':
      console.log('正在重连...');
      break;
  }
});

// 监听错误
wsSrv.errorObs.subscribe(({ errMsg, body }) => {
  console.error('错误:', errMsg, body);
});
```

### 服务端推送订阅

```typescript
// 设置推送订阅
wsSrv.setPushSub({
  'userStatus': 3001,
  'newMessage': 3002
});

// 订阅推送消息
wsSrv.messageObs.get('userStatus')?.subscribe(data => {
  console.log('用户状态变化:', data);
});

wsSrv.messageObs.get('newMessage')?.subscribe(data => {
  console.log('新消息:', data);
});
```

## API

### wsSrv

WebSocket 服务单例实例。

#### 属性

- `isConnected: boolean` - 是否已连接
- `isReconnecting: boolean` - 是否正在重连
- `notifyObs: Observable<WsNotify>` - 连接状态通知
- `errorObs: Observable<{errMsg: string, body?: RspMsgBody}>` - 错误通知
- `messageObs: Map<string, Observable<RspMsgBody>>` - 推送消息集合

#### 方法

##### setConfig(cfg: Cfg)

设置 WebSocket 配置。

```typescript
wsSrv.setConfig({
  wsUrl: 'ws://example.com',
  login: { reqWsKey: 1001 },
  keepAlive: { reqWsKey: 1002 },
  token: () => 'your-token',
  isGuest: () => false
});
```

##### connect(url?: string)

连接到 WebSocket 服务器。

```typescript
wsSrv.connect();
// 或覆盖 URL
wsSrv.connect('ws://new-url.com');
```

##### close()

主动断开连接。

```typescript
wsSrv.close();
```

##### sendMessage(options: WsOptions, data?: ReqData): Observable<RspMsgBody>

发送消息并返回响应的 Observable。

**参数：**

```typescript
interface WsOptions {
  reqWsKey: number;           // 请求原语
  rspWsKey?: number;          // 响应原语
  timeout?: number;           // 超时时间（毫秒）
  ignore?: boolean;           // 不关心响应
  isConsoleInvisible?: boolean; // 不打印日志
  isErrorInvisible?: boolean;   // 不显示错误提示
  errCodeInvisible?: number;    // 特定错误码不提示
  isUndo?: boolean;             // 连接后重发
  filterGuest?: boolean;        // 访客过滤
}
```

**示例：**

```typescript
wsSrv.sendMessage(
  {
    reqWsKey: 2001,
    timeout: 10000,
    isUndo: true
  },
  { param1: 'value1' }
).subscribe({
  next: data => console.log(data),
  error: err => console.error(err)
});
```

##### setPushSub(pushItems: {[key: string]: number})

设置服务端推送订阅。

```typescript
wsSrv.setPushSub({
  'notification': 3001,
  'chat': 3002
});
```

##### setStatus(status: WsStatus)

设置连接状态（0: 正常断开需重连，1: 异地登录无需重连）。

```typescript
wsSrv.setStatus(1); // 异地登录
```

##### checkConnectState(): boolean

检查连接状态。

```typescript
if (wsSrv.checkConnectState()) {
  console.log('已连接');
}
```

### 拦截器

配置全局拦截器。

```typescript
// 配置请求选项拦截器
wsSrv.interceptors.options(() => ({
  timeout: 15000,
  isUndo: true
}));

// 配置请求参数拦截器
wsSrv.interceptors.request(() => ({
  timestamp: Date.now(),
  version: '1.0.0'
}));

// 配置响应错误消息拦截器
wsSrv.interceptors.response((body, options) => {
  if (body.err_code === 401) {
    return '登录已过期';
  }
  return body.err_desc || '请求失败';
});
```

## 消息编解码

库内置二进制消息编解码功能（enigma），支持自定义协议格式：

**消息格式（12 字节头 + 数据体）：**

- 0-3 字节: 魔术头 (0x1234abcd)
- 4-5 字节: 消息总长度
- 6-7 字节: 序列号 (seqNo)
- 8-11 字节: 原语键 (wsKey)
- 12+ 字节: JSON 数据体

## 类型定义

```typescript
interface Cfg {
  wsUrl: string;
  login: WsOptions;
  keepAlive: WsOptions;
  token: () => string;
  isGuest: () => boolean;
}

interface WsNotify {
  type: 'opened' | 'logined' | 'closed' | 'reconnect' | 'loginFailure';
  value?: any;
}

interface RspMsgBody {
  err_code?: number;
  err_desc?: string;
  [key: string]: any;
}

type WsStatus = 0 | 1;
```

## License

MIT © pluschong
