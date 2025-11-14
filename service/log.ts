import { consoleSrv } from '@pluschong/console-overlay';
import { SafeAny } from '@pluschong/safe-type';

export function logger(tag: string, data: SafeAny = '') {
	consoleSrv.info(
		tag,
		data,
		data && data.body && data.body.err_code && data.body.err_code !== 0 ? 'red' : 'blue'
	);
}
