import bigInt from 'big-integer';

import { ArbitrageMode, FeeDerivationInstruction, FeeSplitInstruction } from '../src/types/types';
import { tzbtcToken } from '../src/token/tzbtcToken';

export const delegate = 'tz1...';

export const minimumArb = 500_000;
export const baseAllowance = '0'
export const marketRefreshInterval = 10; // in seconds
export const accountRefreshInterval = 20; // in seconds

export const dPoolAddress = 'KT1TxqZ8QtKvLu3V3JH7Gx58n7Co8pgtpQU5';
export const dPoolStorageMap = { coinBalancePath: '$.args[1].int', tokenBalancePath: '$.args[0].int', liquidityBalancePath: '$.args[2].int' };
export const dExchangeMultiplier = '998';
export const expirationPadding = 5 * 60 * 1000; // 5 min

export const qPoolAddress = 'KT1WBLrLE2vG8SedBqiSJFm4VVAZZBytJYHc';
export const qPoolStorageMap = { coinBalancePath: '$.args[1].args[0].args[1].args[2].int', tokenBalancePath: '$.args[1].args[0].args[2].args[1].int', liquidityBalancePath: '$.args[1].args[0].args[4].int' };
export const qExchangeMultiplier = '997';

export const tezosNode = 'https://...';
export const alternateNodes = [ ];

export const accountAddress = 'tz1...';
export const accountKey = 'edsk...';

export const feeExtra = 2_000; // µtz
export const splitFee = FeeSplitInstruction.Proportion;
export const feeDerivation = FeeDerivationInstruction.GasDescending;
export const arbMode = ArbitrageMode.Dynamic;
export const gasExtra = 100; // gasExtra / 100 must be less than feeExtra
export const storageExtra = 20; // TODO
export const rateTolerance = Math.floor(100 / 5); // 100% / n%

export const siblingAddresses = ['tz1...', 'tz1...'];
