import { ReqData, RspData, WsKey, WsSeqNo } from './websocket.type';

const MAGIC_HEADER = 0x1234abcd;
const HEADER_SIZE = 12;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeMsg(seqNo: WsSeqNo, wsKey: WsKey, obj?: ReqData) {
	const bodyBytes = textEncoder.encode(JSON.stringify(obj || {}));
	const buf = new ArrayBuffer(HEADER_SIZE + bodyBytes.length);
	const dv = new DataView(buf);

	dv.setUint32(0, MAGIC_HEADER, false);
	dv.setUint16(4, buf.byteLength, false);
	dv.setUint16(6, seqNo, false);
	dv.setUint32(8, wsKey, false);

	new Uint8Array(buf, HEADER_SIZE).set(bodyBytes);

	return buf;
}

export function decodeMsg(buf: ArrayBuffer): RspData | null {
	if (buf.byteLength < HEADER_SIZE) return null;

	const dv = new DataView(buf);
	if (dv.getUint32(0, false) !== MAGIC_HEADER) return null;
	if (dv.getUint16(4, false) !== buf.byteLength) return null;

	const bodyStr = textDecoder.decode(buf.slice(HEADER_SIZE));
	return {
		seqNo: dv.getUint16(6, false),
		wsKey: dv.getUint32(8, false),
		body: bodyStr ? JSON.parse(bodyStr) : {}
	};
}
