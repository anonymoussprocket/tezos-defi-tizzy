import { BaseWrapToken } from '../types/types';

export class wwbtcToken extends BaseWrapToken {
    constructor(tokenIndex: number = 19, tokenSymbol: string = 'wWBTC', tokenDecimals: number = 8) {
        super(tokenIndex, tokenSymbol, tokenDecimals);
    }
}
