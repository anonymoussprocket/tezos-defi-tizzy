import fetch from 'node-fetch';
import { TezosConstants, TezosNodeWriter, TezosNodeReader, KeyStore, Signer, TezosMessageUtils, Operation, SignedOperationGroup, Transaction } from 'conseiljs';
import { KeyStoreUtils, SoftSigner } from 'conseiljs-softsigner';
import { OperationFee } from '../types/OperationFee';

function clearRPCOperationGroupHash(hash: string) {
    return hash.replace(/\"/g, '').replace(/\n/, '');
}

/**
 * 
 * @param server 
 * @param accountKey 
 * @returns {keyStore: KeyStore, signer: Signer, counter: number} keyStore, signer, next counter that should be used
 */
export async function initAccount(server: string, accountKey: string): Promise<{keyStore: KeyStore, signer: Signer, counter: number}> {
    const keyStore = await KeyStoreUtils.restoreIdentityFromSecretKey(accountKey);
    const signer = await SoftSigner.createSigner(TezosMessageUtils.writeKeyWithHint(keyStore.secretKey, 'edsk'));
    const counter = await TezosNodeReader.getCounterForAccount(server, keyStore.publicKeyHash) + 1;

    return { keyStore, signer, counter };
}

/**
 * 
 * @param server Tezos node
 * @param address Account address
 * @returns 
 */
export async function getCounter(server: string, address: string) {
    return (await TezosNodeReader.getCounterForAccount(server, address)) + 1;
}

export async function getAccountState(server: string, address: string): Promise<{ balance: number, counter: number, delegate: string }> {
    return await fetch(`${server}/chains/main/blocks/head/context/contracts/${address}`, { method: 'get' }).
        then(async (response) => {
            if (response.ok) {
                const result = await response.json();
                return {
                    balance: Number(result['balance']),
                    counter: Number(result['counter']) + 1,
                    delegate: result['delegate'] };
            }

            return { balance: -1, counter: -1, delegate: '' };
        }).catch(e => { return { balance: -1, counter: -1, delegate: '' } });
}

/**
 * Updates the counter of the operations in the order they appear in the parameter array.
 * 
 * @param operations Operation list
 * @param counter Starting counter
 */
export function renumberOperations(operations: any[], initialCounter: number) {
    return operations.map((o, i) => { return { ...o, counter: `${initialCounter + i}` } });
}

export function overlayOperationFees(operations: any[], fees: OperationFee[]) {
    return operations.map((o, i) => { return { ...o, gas_limit: `${fees[i].gas}`, fee: `${fees[i].fee}`, storage_limit: `${fees[i].storage}` } });
}

export async function priceOperations(tezosNode: string, operations: any[]): Promise<Transaction[]> {
    const estimate = await TezosNodeWriter.estimateOperationGroup(tezosNode, 'main', operations);

    const totalGas = estimate.operationResources.map(r => r.gas).reduce((a, c) => a +=c , 0);
    const feeRatio = estimate.estimatedFee / totalGas;

    let priced: Transaction[] = [];
    for (let i = 0; i < operations.length; i++) {
        priced.push({
            ...operations[i],
            fee: `${Math.ceil(feeRatio * estimate.operationResources[i].gas)}`,
            gas_limit: `${estimate.operationResources[i].gas}`,
            storage_limit: `${estimate.operationResources[i].storageCost}`
        });
    };

    return priced;
}

export async function composeOperation(
    server: string,
    operations: Operation[],
    signer: Signer,
    offset: number = TezosConstants.HeadBranchOffset
    ): Promise<SignedOperationGroup> {
    const blockHead = await TezosNodeReader.getBlockAtOffset(server, offset);
    const blockHash = blockHead.hash.slice(0, 51); // consider throwing an error instead

    const forgedOperationGroup = TezosNodeWriter.forgeOperations(blockHash, operations);

    const opSignature = await signer.signOperation(Buffer.from(TezosConstants.OperationGroupWatermark + forgedOperationGroup, 'hex'));

    const signedOpGroup = Buffer.concat([Buffer.from(forgedOperationGroup, 'hex'), opSignature]);
    const base58signature = TezosMessageUtils.readSignatureWithHint(opSignature, signer.getSignerCurve());

    return { bytes: signedOpGroup, signature: base58signature };
}

export async function preapplyOperation(server: string, operations: Operation[], signer: Signer, offset: number = TezosConstants.HeadBranchOffset): Promise<any> {
    const blockHead = await TezosNodeReader.getBlockAtOffset(server, offset);
    const blockHash = blockHead.hash.slice(0, 51); // consider throwing an error instead
    const protocol = blockHead.protocol;

    const forgedOperationGroup = TezosNodeWriter.forgeOperations(blockHash, operations);

    const opSignature = await signer.signOperation(Buffer.from(TezosConstants.OperationGroupWatermark + forgedOperationGroup, 'hex'));

    const signedOpGroup = Buffer.concat([Buffer.from(forgedOperationGroup, 'hex'), opSignature]);
    const base58signature = TezosMessageUtils.readSignatureWithHint(opSignature, signer.getSignerCurve());
    const opPair = { bytes: signedOpGroup, signature: base58signature };

    return await TezosNodeWriter.preapplyOperation(server, blockHash, protocol, operations, opPair);
}

export async function getBranch(server: string, offset: number): Promise<{hash: string, timestamp: Date}> {
    const block = await TezosNodeReader.getBlockAtOffset(server, offset);
    const hash = block.hash.slice(0, 51); // consider throwing an error instead
    const timestamp = new Date(block.header.timestamp);

    return { hash, timestamp };
}

/**
 * Injects a fully-formed operation without preapply. Branch for the operation is queried for first.
 * 
 * @param server 
 * @param operations 
 * @param signer 
 * @param offset 
 * @returns 
 */
export async function sendOperation( // TODO: this needs a timeout
    server: string,
    operations: Operation[],
    signer: Signer,
    offset: number = TezosConstants.HeadBranchOffset
    ): Promise<any> {
    const blockHead = await TezosNodeReader.getBlockAtOffset(server, offset);
    const blockHash = blockHead.hash.slice(0, 51);

    const forgedOperationGroup = TezosNodeWriter.forgeOperations(blockHash, operations);

    const opSignature = await signer.signOperation(Buffer.from(TezosConstants.OperationGroupWatermark + forgedOperationGroup, 'hex'));

    const signedOpGroup = Buffer.concat([Buffer.from(forgedOperationGroup, 'hex'), opSignature]);
    const base58signature = TezosMessageUtils.readSignatureWithHint(opSignature, signer.getSignerCurve());
    const opPair = { bytes: signedOpGroup, signature: base58signature };
    const injectedOperation = await TezosNodeWriter.injectOperation(server, opPair);

    return clearRPCOperationGroupHash(injectedOperation);
}

/**
 * Injects a fully-formed operation without preapply with a previously-known branch for reduced latency.
 * 
 * @param server 
 * @param operations 
 * @param signer 
 * @param branch 
 * @returns 
 */
export async function sendOperationWithBranch(
    server: string,
    operations: Operation[],
    signer: Signer,
    branch: string
    ): Promise<any> {
    const forgedOperationGroup = TezosNodeWriter.forgeOperations(branch, operations);

    const opSignature = await signer.signOperation(Buffer.from(TezosConstants.OperationGroupWatermark + forgedOperationGroup, 'hex'));

    const signedOpGroup = Buffer.concat([Buffer.from(forgedOperationGroup, 'hex'), opSignature]);
    const base58signature = TezosMessageUtils.readSignatureWithHint(opSignature, signer.getSignerCurve());
    const opPair = { bytes: signedOpGroup, signature: base58signature };
    const injectedOperation = await TezosNodeWriter.injectOperation(server, opPair);

    return clearRPCOperationGroupHash(injectedOperation);
}

export async function getCoinBalance(tezosNode, address): Promise<number> {
    return await TezosNodeReader.getSpendableBalanceForAccount(tezosNode, address);
}

/**
 * 
 * @param tezosNode 
 * @param addresses 
 * @returns 
 */
export async function getMempool(tezosNode: string, targetAddresses: string[], ignoreSources: string[] = []): Promise<any[]> {
    const operations: any[] = await fetch(`${tezosNode}/chains/main/mempool/pending_operations`, { method: 'get' })
        .then(async (response) => {
            if (response.ok) { return (await response.json())['applied']; }
            return [];
        }).catch(e => []);

    let selected: any[] = [];
    operations.forEach(c => {
        const group = c['contents'];

        group.forEach(o => {
            if (targetAddresses.includes(o['destination']) && !ignoreSources.includes(o['source'])) {
                selected.push(group);
                return;
            }
        });
    });

    return selected;
}

export async function getHeadInfo(tezosNode: string): Promise<{ timestamp: Date, level: number }> {
    return await fetch(`${tezosNode}/chains/main/blocks/head/header`, { method: 'get' }).
        then(async (response) => {
            if (response.ok) {
                const jsonData = (await response.json());
                return { timestamp: new Date(jsonData['timestamp']), level: jsonData['level']};
            }
            return { timestamp: new Date(0), level: -1 };
        }).catch(e => { return { timestamp: new Date(0), level: -1 } });
}

export async function changeDelegate(tezosNode: string, signer: Signer, keyStore: KeyStore, delegate: string): Promise<string> {
    const accountState = await getAccountState(tezosNode, keyStore.publicKeyHash);
    if (accountState.counter < 0) { return; }
    if (accountState.delegate == delegate) { return; }

    const operationGroupID = clearRPCOperationGroupHash((await TezosNodeWriter.sendDelegationOperation(tezosNode, signer, keyStore, delegate, 0, TezosConstants.HeadBranchOffset, true)).operationGroupID);
    return operationGroupID;
}
