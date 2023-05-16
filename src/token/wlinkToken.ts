import { BaseWrapToken } from '../types/types';

export class wlinkToken extends BaseWrapToken {
    constructor(tokenIndex: number = 10, tokenSymbol: string = 'wLINK', tokenDecimals: number = 18) {
        super(tokenIndex, tokenSymbol, tokenDecimals);
    }
}
