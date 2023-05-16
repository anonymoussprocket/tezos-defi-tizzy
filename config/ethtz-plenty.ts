import bigInt from 'big-integer';

import { ArbitrageMode, FeeDerivationInstruction, FeeSplitInstruction } from '../src/types/types';
import { BotPlenty } from '../src/bot/BotPlenty';
import { PlentySwap } from '../src/market/PlentySwap';
import { QuipuSwap } from '../src/market/QuipuSwap';
import { plentyToken } from '../src/token/plentyToken';
import { ethtzToken } from '../src/token/ethtzToken';

export const delegate = 'tz1...';

export const minimumArb = 500_000;
export const baseAllowance = '0'
export const marketRefreshInterval = 10; // in seconds
export const accountRefreshInterval = 20; // in seconds

export const sourcePoolAddress = 'KT1AbuUaPQmYLsB8n8FdSzBrxvrsm8ctwW1V'; // plenty ETHtz pool
export const sourcePoolStorageMap = { coinBalancePath: '$.args[1].args[1].int', tokenBalancePath: '$.args[4].int', liquidityBalancePath: '$.args[5].int' };
export const sourcePoolMultiplier = '996';

export const outputPoolAddress = 'KT1Evsp2yA19Whm24khvFPcwimK6UaAJu8Zo'; // quipu ETHtz pool
export const outputPoolStorageMap = { coinBalancePath: '$.args[1].args[0].args[1].args[2].int', tokenBalancePath: '$.args[1].args[0].args[2].args[1].int', liquidityBalancePath: '$.args[1].args[0].args[4].int' };
export const outputPoolMultiplier = '997';

export const cashExchangePoolAddress = 'KT1X1LgNkQShpF9nRLYw3Dgdy4qp38MX617z'; // quipu Plenty pool
export const cashExchangePoolStorageMap = { coinBalancePath: '$.args[1].args[0].args[1].args[2].int', tokenBalancePath: '$.args[1].args[0].args[2].args[1].int', liquidityBalancePath: '$.args[1].args[0].args[4].int' };
export const cashExchangePoolMultiplier = '997';

export const otherPools = ['KT1PDrBE59Zmxnb8vXRgRAG1XmvTMTs5EDHU'];

export const tezosNode = 'https://...';
export const alternateNodes = [ ];

export const accountAddress = 'tz1...';
export const accountKey = 'edsk...';

export const feeExtra = 2_000; // µtz
export const splitFee = FeeSplitInstruction.Proportion;
export const feeDerivation = FeeDerivationInstruction.GasDescending;
export const arbMode = ArbitrageMode.Dynamic;
export const gasExtra = 100; // gasExtra / 10 must be less than feeExtra
export const storageExtra = 30; // TODO
export const rateTolerance = Math.floor(100 / 5); // 100% / n%
export const nativeCashArb = true;

export const siblingAddresses = ['tz1...', 'tz1...'];

export function initBotPair() {
    const token = new ethtzToken();
    const plenty = new plentyToken();

    const inputSwap = new PlentySwap(sourcePoolAddress, sourcePoolStorageMap, sourcePoolMultiplier, token, [outputPoolAddress, ...otherPools], tezosNode);
    const outputSwap = new QuipuSwap(outputPoolAddress, outputPoolStorageMap, outputPoolMultiplier, token, [sourcePoolAddress, ...otherPools], tezosNode);
    const cashSwap = new QuipuSwap(cashExchangePoolAddress, cashExchangePoolStorageMap, cashExchangePoolMultiplier, plenty, [], tezosNode);

    const config = { delegate, minimumArb, baseAllowance, marketRefreshInterval, accountRefreshInterval, tezosNode, alternateNodes, accountAddress, accountKey, feeExtra, splitFee, arbMode, gasExtra, storageExtra, rateTolerance, siblingAddresses, feeDerivation, nativeCashArb };

    const inputBot = new BotPlenty(token, inputSwap, outputSwap, cashSwap, config);
    const outputBot = new BotPlenty(token, outputSwap, inputSwap, cashSwap, config);

    return [inputBot, outputBot];
}
