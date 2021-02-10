import BigNumber from 'bignumber.js';
import { ethers } from 'ethers';
import { Contract } from '@ethersproject/contracts';
import { ErrorCode } from '@ethersproject/logger';
import { Web3Provider } from '@ethersproject/providers';
import { Swap } from '@balancer-labs/sor/dist/types';

import ExchangeProxyABI from '../abi/ExchangeProxy.json';
import ERC20ABI from '../abi/ERC20.json';
import ForwarderABI from '../abi/Fowarder.json';

import config from '@/config';
import { AssetType, ETH_KEY, logRevertedTx, scale } from '@/utils/helpers';
import { signDaiPermit, signERC2612Permit, signUNIPermit } from "eth-permit-custom"
import axios from 'axios'


import { TypedDataUtils } from 'eth-sig-util';
import { bufferToHex, zeroAddress } from 'ethereumjs-util';
import { AddressZero, MaxUint256 } from '@ethersproject/constants';
import account from '@/store/modules/account';
import store from '@/store';
import { MAX_UINT } from '@balancer-labs/sor/dist/sor';

require("dotenv-webpack");

const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const exchangeProxyAddress = config.addresses.exchangeProxy;
const forwarderAddress = config.addresses.forwarder;


// const { TypedDataUtils } = require('eth-sig-util');
// const { bufferToHex } = require('ethereumjs-util');

// const daiLikeERC20 = "0xCc2c421C7B77c09b0cCE50E3764CA57521396dD5";
// const uniLikeERC20 = "0x1D140A670D8aA92b227fAa477FD5E899D77D3dC2";

// interface DaiLikePermit{
//     expiry:BigNumber:
//     v:Number:r:BigNumber:s:BigNumber;
// }
const biconomyApiKey = config.chainId === 1 ? process.env["BICONOMY_API_KEY"] : 'Ky5ZkIfJ6.0762d9f4-77b5-4fb8-a032-3d384a384c9f';
const biconomyMethodAPIKey = config.chainId === 1 ? process.env["BICONOMY_API_METHOD_KEY"] : 'ebc83b24-6e81-435a-bd2b-45cfc51d6668';
const headers = {
    'x-api-key': biconomyApiKey,
    'Content-Type': 'application/json',
};
const ethGasStationInfoApiKey = '23d9e4368cef3a32a93062544dce537fc3ccad93e59b9265ec007966d4d7';
const apiData = {
    'userAddress': '',
    'from': '',
    'to': '',
    'gasLimit': '',
    'params': Array(0),
    'apiId': biconomyMethodAPIKey,
};
const EIP712DomainType = [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
]

const ForwardRequestType = [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'data', type: 'bytes' },
]
const version = config.chainId === 1 ? '1.0.0+balancer.exchangeproxy.gasless' : '1';
const TypedData = {
    domain: {
        name: 'BalancerProxyUpkaran',
        version: version,
        chainId: config.chainId,
        verifyingContract: forwarderAddress,
    },
    primaryType: 'ForwardRequest',
    types: {
        EIP712Domain: EIP712DomainType,
        ForwardRequest: ForwardRequestType,
    },
    message: {},
};

//add interfaces for request,repay,permit etc...

const GenericParams = 'address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data';
const TypeName = `ForwardRequest(${GenericParams})`;
const TypeHash = ethers.utils.id(TypeName);

const DomainSeparator = bufferToHex(TypedDataUtils.hashStruct('EIP712Domain', TypedData.domain, TypedData.types));

const SuffixData = '0x';
// temprary measure
const extraGas = new BigNumber('50000');
// const extraGas = new BigNumber('0');
const repayTo = config.addresses.repayTo;






export default class Swapper {

    static async getRepayAmount(provider: Web3Provider, from: string, data: string, assetInAddress: string, assetInAmount: BigNumber): Promise<BigNumber> {

        try {

            const ethGasStationRes = await axios({ method: 'GET', url: 'https://data-api.defipulse.com/api/v1/egs/api/ethgasAPI.json?api-key=' + ethGasStationInfoApiKey });
            const fastGasPrice = new BigNumber(ethGasStationRes.data.fast);

            const fastGasPriceinEth = scale(fastGasPrice, -10);
            console.log('fastGasPrice', fastGasPrice.toString());
            console.log('fastGasPriceinEth', fastGasPriceinEth.toString());

            const coinGeckoEthPriceRes = await axios({ method: 'GET', url: 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd' });
            const ethPriceInUSD = new BigNumber(coinGeckoEthPriceRes.data.ethereum.usd);
            console.log('ethPriceInUSD', ethPriceInUSD.toString());

            const estimatedGasSimpleSwap = await provider.estimateGas({
                to: exchangeProxyAddress,
                from: from,
                data: data,
            });

            const estimatedGasSimpleSwapRaw = new BigNumber(estimatedGasSimpleSwap.toString());
            console.log('estimatedGasSimpleSwapRaw', estimatedGasSimpleSwapRaw.toString());
            const totalEstimatedGas = estimatedGasSimpleSwapRaw.plus(extraGas);
            console.log('totalEstimatedGas', totalEstimatedGas.toString());
            apiData.gasLimit = totalEstimatedGas.toString();

            // let repayAmount = totalEstimatedGas.multipliedBy(fastGasPriceinEth).multipliedBy(ethPriceInUSD);
            //temporarily
            let repayAmount = estimatedGasSimpleSwapRaw.multipliedBy(fastGasPriceinEth).multipliedBy(ethPriceInUSD);
            console.log('repayAmount', repayAmount.toString());
            // repayAmount = new BigNumber('10');


            const metadata = store.getters['assets/metadata'];
            const assetInDecimals = metadata[assetInAddress].decimals;

            // const assetInDecimals = 6;
            console.log('assetInDecimals', assetInDecimals);
            const repayAmountScaled = scale(repayAmount, assetInDecimals);

            console.log('repayAmountSacled', repayAmountScaled.toString());
            const erc20 = new Contract(assetInAddress, ERC20ABI, provider.getSigner());
            const balance = await erc20.balanceOf(from);

            console.log('balance', balance.toString());
            console.log('assetInAmount', assetInAmount.toString());

            console.log('!has enough balance', new BigNumber(balance.toString()).lt(assetInAmount.plus(repayAmountScaled)));
            const assetSymbol = metadata[assetInAddress].symbol;
            store.dispatch('ui/notify', {
                text: `${repayAmount.toFixed(2)} ${assetSymbol}`,
                type: 'info',
                link: 'https://t.me/upkaranam',
            });
            if (new BigNumber(balance.toString()).lt(assetInAmount.plus(repayAmountScaled))) {
                throw new Error();
            }

            return repayAmountScaled;
        }
        catch (e) {
            return new BigNumber(0);
        }

    }

    static async swapIn(
        provider: Web3Provider,
        swaps: Swap[][],
        assetInAddress: string,
        assetOutAddress: string,
        assetInAmount: BigNumber,
        assetOutAmountMin: BigNumber,
        assetInType: AssetType,
        isAllowanceRequired: boolean,
    ): Promise<any> {

        const overrides: any = {};
        // overrides.gasLimit  = '700000';
        let functionName = '';
        let data;
        // const ethGasStationRes = await axios({method:'GET',url:'https://data-api.defipulse.com/api/v1/egs/api/ethgasAPI.json?api-key=' + ethGasStationInfoApiKey});
        // const fastGasPrice = new BigNumber(ethGasStationRes.data.fast);

        // const fastGasPriceinEth = scale(fastGasPrice, -10);
        // console.log('fastGasPrice',fastGasPrice.toString());
        // console.log('fastGasPriceinEth',fastGasPriceinEth.toString())

        // const coinGeckoEthPriceRes =  await axios({method:'GET',url:'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'});
        // const ethPriceInUSD = new BigNumber(coinGeckoEthPriceRes.data.ethereum.usd);
        // console.log('ethPriceInUSD',ethPriceInUSD.toString());


        const accounts = await provider.listAccounts();
        // const repay = {
        //     repayInToken : AddressZero,
        //     repayAmount : '0',
        //     repayTo:AddressZero,
        // }


        if (assetInAddress === ETH_KEY) {
            assetInAddress = ETH_ADDRESS;
            overrides.value = `0x${assetInAmount.toString(16)}`;
        }
        if (assetOutAddress === ETH_KEY) {
            assetOutAddress = ETH_ADDRESS;
        }
        const repay = {
            repayInToken: assetInAddress,
            repayAmount: '1',
            repayTo: repayTo,
        };
        console.log('repay ****', repay);
        const exchangeProxyContract = new Contract(exchangeProxyAddress, ExchangeProxyABI, provider.getSigner());
        const forwarder = new Contract(forwarderAddress, ForwarderABI, provider.getSigner());
        const exchangeProxyInterface = new ethers.utils.Interface(ExchangeProxyABI);
        const forwarderInterface = new ethers.utils.Interface(ForwarderABI);


        if (isAllowanceRequired === false || assetInType === undefined || assetInType === AssetType.Simple) {
            // if(assetInAddress === ETH_ADDRESS ){
            if (assetInAddress === ETH_ADDRESS || assetInType === undefined || assetInType === AssetType.Simple) {
                repay.repayInToken = AddressZero;
                repay.repayAmount = '0';
                repay.repayTo = AddressZero;
                return await exchangeProxyContract.multihopBatchSwapExactIn(
                    swaps,
                    assetInAddress,
                    assetOutAddress,
                    assetInAmount.toString(),
                    assetOutAmountMin.toString(),
                    repay,
                    overrides,
                );
            }
            functionName = 'multihopBatchSwapExactIn';
            data = exchangeProxyInterface.encodeFunctionData(functionName, [swaps,
                assetInAddress,
                assetOutAddress,
                assetInAmount.toString(),
                assetOutAmountMin.toString(),
                repay]);
            const repayAmount = await this.getRepayAmount(provider, accounts[0], data, assetInAddress, assetInAmount);
            repay.repayAmount = repayAmount.toFixed(0);
            console.log('repay', repay);
            //use the updated repay object
            data = exchangeProxyInterface.encodeFunctionData(functionName, [swaps,
                assetInAddress,
                assetOutAddress,
                assetInAmount.toString(),
                assetOutAmountMin.toString(),
                repay]);
        }
        // let permit;
        // let daiLikePermit;
        else if (assetInType === AssetType.DAILike) {
            functionName = 'multihopBatchSwapExactInDAILike';
            const permit = await signDaiPermit(provider, assetInAddress, accounts[0], exchangeProxyAddress);
            console.log('permit is:', permit);
            const daiLikePermit = [
                permit.expiry.toString(),
                permit.v,
                permit.r,
                permit.s,
            ];
            data = exchangeProxyInterface.encodeFunctionData(functionName, [swaps,
                assetInAddress,
                assetOutAddress,
                assetInAmount.toString(),
                assetOutAmountMin.toString(),
                repay,
                daiLikePermit]);
            const repayAmount = await this.getRepayAmount(provider, accounts[0], data, assetInAddress, assetInAmount);
            repay.repayAmount = repayAmount.toFixed(0);
            data = exchangeProxyInterface.encodeFunctionData(functionName, [swaps,
                assetInAddress,
                assetOutAddress,
                assetInAmount.toString(),
                assetOutAmountMin.toString(),
                repay,
                daiLikePermit]);


        }
        else if (assetInType === AssetType.EIP2612Like) {
            functionName = 'multihopBatchSwapExactInEIP2612Like';
            const permit = await signERC2612Permit(provider, assetInAddress, accounts[0], exchangeProxyAddress, MaxUint256.toString());
            console.log('permit is:', permit);
            const eip2612LikePermit = [
                permit.value,
                permit.deadline.toString(),
                permit.v,
                permit.r,
                permit.s,
            ];
            data = exchangeProxyInterface.encodeFunctionData(functionName, [swaps,
                assetInAddress,
                assetOutAddress,
                assetInAmount.toString(),
                assetOutAmountMin.toString(),
                repay,
                eip2612LikePermit]);

            const repayAmount = await this.getRepayAmount(provider, accounts[0], data, assetInAddress, assetInAmount);
            repay.repayAmount = repayAmount.toFixed(0);
            data = exchangeProxyInterface.encodeFunctionData(functionName, [swaps,
                assetInAddress,
                assetOutAddress,
                assetInAmount.toString(),
                assetOutAmountMin.toString(),
                repay,
                eip2612LikePermit]);



        }

        if (repay.repayAmount.toString() === '0') {
            //a heck so that it fails gracefully
            return { status: 1 };
        }


        //in the first iteration we will do it just for currencies that are pegged to us dollars



        //repayInToken,amount,repayTO
        // let daiLikePermit = {
        //     expiry:permit?.expiry.toString(),
        //     v:permit?.v,
        //     r:permit?.r,
        //     s:permit?.s
        // }

        // console.log(daiLikePermit)
        // const exchangeProxyContract = new Contract(exchangeProxyAddress, ExchangeProxyABI, provider.getSigner());
        // const forwarder = new Contract(forwarderAddress,ForwarderABI, provider.getSigner());
        // const exchangeProxyInterface = new ethers.utils.Interface(ExchangeProxyABI);

        // const data = exchangeProxyInterface.encodeFunctionData(functionName, [swaps,
        //     assetInAddress,
        //     assetOutAddress,
        //     assetInAmount.toString(),
        //     assetOutAmountMin.toString(),
        //     repay,
        //     daiLikePermit]);

        const nonce = await forwarder.getNonce(accounts[0]).then((nonce: any) => nonce.toString());

        const request = {
            from: accounts[0],
            to: exchangeProxyAddress,
            value: 0,
            gas: '700000',
            nonce,
            data,
        };
        const toSign = { ...TypedData, message: request };
        console.log(toSign);

        const signature = await provider.send('eth_signTypedData_v4', [accounts[0], JSON.stringify(toSign)]);
        console.log(signature);
        const args = [
            request,
            DomainSeparator,
            TypeHash,
            SuffixData,
            signature,
        ];
        console.log(args);
        const verification = await forwarder.verify(...args);

        //following does not work
        // const finalData = forwarderInterface.encodeFunctionData('execute',args);
        // const estimatedFinalGas = await provider.estimateGas({
        //     to:forwarderAddress,
        //     from:accounts[0],
        //     data:finalData,
        // });

        // console.log('estimatedFinalGas',estimatedFinalGas.toString());
        // apiData.gasLimit = estimatedFinalGas.toString();


        //following does not work
        // const estimatedGas = await provider.estimateGas(verification);
        // console.log('estimatedGas',estimatedGas.toString());
        // apiData.gasLimit = estimatedGas.toString();
        // console.log('verification',verification);
        // try {



        // const functionData = 
        // exchangeProxyContract.encodeFunctionData(
        //     "multihopBatchSwapExactInDAILike",
        //     [swaps,
        //     assetInAddress,
        //     assetOutAddress,
        //     assetInAmount.toString(),
        //     assetOutAmountMin.toString(),
        //     daiLikePermit, overrides]
        // );
        // console.log("functionData",functionData)
        // console.log("try")

        // return await exchangeProxyContract.multihopBatchSwapExactInDAILike(
        //     swaps,
        //     assetInAddress,
        //     assetOutAddress,
        //     assetInAmount.toString(),
        //     assetOutAmountMin.toString(),
        //     repay,
        //     daiLikePermit,
        //     overrides,
        // );

        apiData.userAddress = accounts[0];
        apiData.from = accounts[0];
        apiData.to = forwarderAddress;
        apiData.params = args;
        console.log('apiData', apiData);


        return axios({ method: 'post', url: 'https://api.biconomy.io/api/v2/meta-tx/native', headers: headers, data: apiData });

        // return await forwarder.execute(...args,overrides);


        // } catch(e) {
        //     if (e.code === ErrorCode.UNPREDICTABLE_GAS_LIMIT) {
        //         const sender = await provider.getSigner().getAddress();
        //         logRevertedTx(
        //             sender,
        //             exchangeProxyContract,
        //             'multihopBatchSwapExactIn',
        //             [
        //                 swaps,
        //                 assetInAddress,
        //                 assetOutAddress,
        //                 assetInAmount.toString(),
        //                 assetOutAmountMin.toString(),
        //             ],
        //             overrides,
        //         );
        //     }
        //     return e;
        // }
    }
    static async swapOut(
        provider: Web3Provider,
        swaps: Swap[][],
        assetInAddress: string,
        assetOutAddress: string,
        // assetInAmount: BigNumber,
        assetInAmountMax: BigNumber,
        assetInType: AssetType,
        isAllowanceRequired: boolean,
    ): Promise<any> {
        const assetInAmount = assetInAmountMax;

        const overrides: any = {};
        // overrides.gasLimit  = '700000';
        let functionName = '';
        let data;
        // const ethGasStationRes = await axios({method:'GET',url:'https://data-api.defipulse.com/api/v1/egs/api/ethgasAPI.json?api-key=' + ethGasStationInfoApiKey});
        // const fastGasPrice = new BigNumber(ethGasStationRes.data.fast);

        // const fastGasPriceinEth = scale(fastGasPrice, -10);
        // console.log('fastGasPrice',fastGasPrice.toString());
        // console.log('fastGasPriceinEth',fastGasPriceinEth.toString())

        // const coinGeckoEthPriceRes =  await axios({method:'GET',url:'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'});
        // const ethPriceInUSD = new BigNumber(coinGeckoEthPriceRes.data.ethereum.usd);
        // console.log('ethPriceInUSD',ethPriceInUSD.toString());


        const accounts = await provider.listAccounts();
        // const repay = {
        //     repayInToken : AddressZero,
        //     repayAmount : '0',
        //     repayTo:AddressZero,
        // }


        if (assetInAddress === ETH_KEY) {
            assetInAddress = ETH_ADDRESS;
            overrides.value = `0x${assetInAmount.toString(16)}`;
        }
        if (assetOutAddress === ETH_KEY) {
            assetOutAddress = ETH_ADDRESS;
        }
        const repay = {
            repayInToken: assetInAddress,
            repayAmount: '1',
            repayTo: repayTo,
        };
        console.log('repay ****', repay);
        const exchangeProxyContract = new Contract(exchangeProxyAddress, ExchangeProxyABI, provider.getSigner());
        const forwarder = new Contract(forwarderAddress, ForwarderABI, provider.getSigner());
        const exchangeProxyInterface = new ethers.utils.Interface(ExchangeProxyABI);


        if (isAllowanceRequired === false || assetInType === undefined || assetInType === AssetType.Simple) {
            if (assetInAddress === ETH_ADDRESS) {
                // if(assetInAddress === ETH_ADDRESS  || assetInType === undefined || assetInType === AssetType.Simple){
                repay.repayInToken = AddressZero;
                repay.repayAmount = '0';
                repay.repayTo = AddressZero;
                return await exchangeProxyContract.multihopBatchSwapExactOut(
                    swaps,
                    assetInAddress,
                    assetOutAddress,

                    assetInAmountMax.toString(),
                    repay,
                    overrides,
                );
            }
            functionName = 'multihopBatchSwapExactOut';
            data = exchangeProxyInterface.encodeFunctionData(functionName, [swaps,
                assetInAddress,
                assetOutAddress,

                assetInAmountMax.toString(),
                repay]);
            const repayAmount = await this.getRepayAmount(provider, accounts[0], data, assetInAddress, assetInAmount);
            repay.repayAmount = repayAmount.toFixed(0);
            console.log('repay', repay);
            //use the updated repay object
            data = exchangeProxyInterface.encodeFunctionData(functionName, [swaps,
                assetInAddress,
                assetOutAddress,

                assetInAmountMax.toString(),
                repay]);
        }
        // let permit;
        // let daiLikePermit;
        else if (assetInType === AssetType.DAILike) {
            functionName = 'multihopBatchSwapExactOutDAILike';
            const permit = await signDaiPermit(provider, assetInAddress, accounts[0], exchangeProxyAddress);
            console.log('permit is:', permit);
            const daiLikePermit = [
                permit.expiry.toString(),
                permit.v,
                permit.r,
                permit.s,
            ];
            data = exchangeProxyInterface.encodeFunctionData(functionName, [swaps,
                assetInAddress,
                assetOutAddress,

                assetInAmountMax.toString(),
                repay,
                daiLikePermit]);
            const repayAmount = await this.getRepayAmount(provider, accounts[0], data, assetInAddress, assetInAmount);
            repay.repayAmount = repayAmount.toFixed(0);
            data = exchangeProxyInterface.encodeFunctionData(functionName, [swaps,
                assetInAddress,
                assetOutAddress,

                assetInAmountMax.toString(),
                repay,
                daiLikePermit]);


        }
        else if (assetInType === AssetType.EIP2612Like) {
            functionName = 'multihopBatchSwapExactOutEIP2612Like';
            const permit = await signERC2612Permit(provider, assetInAddress, accounts[0], exchangeProxyAddress, MaxUint256.toString());
            console.log('permit is:', permit);
            const eip2612LikePermit = [
                permit.value,
                permit.deadline.toString(),
                permit.v,
                permit.r,
                permit.s,
            ];
            data = exchangeProxyInterface.encodeFunctionData(functionName, [swaps,
                assetInAddress,
                assetOutAddress,

                assetInAmountMax.toString(),
                repay,
                eip2612LikePermit]);

            const repayAmount = await this.getRepayAmount(provider, accounts[0], data, assetInAddress, assetInAmount);
            repay.repayAmount = repayAmount.toFixed(0);
            data = exchangeProxyInterface.encodeFunctionData(functionName, [swaps,
                assetInAddress,
                assetOutAddress,

                assetInAmountMax.toString(),
                repay,
                eip2612LikePermit]);



        }

        if (repay.repayAmount.toString() === '0') {
            //a heck so that it fails gracefully
            return { status: 1 };
        }



        //in the first iteration we will do it just for currencies that are pegged to us dollars



        //repayInToken,amount,repayTO
        // let daiLikePermit = {
        //     expiry:permit?.expiry.toString(),
        //     v:permit?.v,
        //     r:permit?.r,
        //     s:permit?.s
        // }

        // console.log(daiLikePermit)
        // const exchangeProxyContract = new Contract(exchangeProxyAddress, ExchangeProxyABI, provider.getSigner());
        // const forwarder = new Contract(forwarderAddress,ForwarderABI, provider.getSigner());
        // const exchangeProxyInterface = new ethers.utils.Interface(ExchangeProxyABI);

        // const data = exchangeProxyInterface.encodeFunctionData(functionName, [swaps,
        //     assetInAddress,
        //     assetOutAddress,
        //    
        //     assetInAmountMax.toString(),
        //     repay,
        //     daiLikePermit]);

        const nonce = await forwarder.getNonce(accounts[0]).then((nonce: any) => nonce.toString());

        const request = {
            from: accounts[0],
            to: exchangeProxyAddress,
            value: 0,
            gas: '700000',
            nonce,
            data,
        };
        const toSign = { ...TypedData, message: request };
        console.log(toSign);

        const signature = await provider.send('eth_signTypedData_v4', [accounts[0], JSON.stringify(toSign)]);
        console.log(signature);
        const args = [
            request,
            DomainSeparator,
            TypeHash,
            SuffixData,
            signature,
        ];
        console.log(args);
        const verification = await forwarder.verify(...args);
        //following does not work
        // const estimatedGas = await provider.estimateGas(verification);
        // console.log('estimatedGas',estimatedGas.toString());
        // apiData.gasLimit = estimatedGas.toString();
        // console.log('verification',verification)
        // try {



        // const functionData = 
        // exchangeProxyContract.encodeFunctionData(
        //     "multihopBatchSwapExactOutDAILike",
        //     [swaps,
        //     assetInAddress,
        //     assetOutAddress,
        //    
        //     assetInAmountMax.toString(),
        //     daiLikePermit, overrides]
        // );
        // console.log("functionData",functionData)
        // console.log("try")

        // return await exchangeProxyContract.multihopBatchSwapExactOutDAILike(
        //     swaps,
        //     assetInAddress,
        //     assetOutAddress,
        //    
        //     assetInAmountMax.toString(),
        //     repay,
        //     daiLikePermit,
        //     overrides,
        // );

        apiData.userAddress = accounts[0];
        apiData.from = accounts[0];
        apiData.to = forwarderAddress;
        apiData.params = args;
        console.log(apiData);


        return axios({ method: 'post', url: 'https://api.biconomy.io/api/v2/meta-tx/native', headers: headers, data: apiData });

        // return await forwarder.execute(...args,overrides);


        // } catch(e) {
        //     if (e.code === ErrorCode.UNPREDICTABLE_GAS_LIMIT) {
        //         const sender = await provider.getSigner().getAddress();
        //         logRevertedTx(
        //             sender,
        //             exchangeProxyContract,
        //             'multihopBatchSwapExactOut',
        //             [
        //                 swaps,
        //                 assetInAddress,
        //                 assetOutAddress,
        //                
        //                 assetInAmountMax.toString(),
        //             ],
        //             overrides,
        //         );
        //     }
        //     return e;
        // }
    }


    // static async swapIn(
    //     provider: Web3Provider,
    //     swaps: Swap[][],
    //     assetInAddress: string,
    //     assetOutAddress: string,
    //     assetInAmount: BigNumber,
    //     assetOutAmountMin: BigNumber,
    // ): Promise<any> {
    //     const overrides: any = {};
    //     if (assetInAddress === ETH_KEY) {
    //         assetInAddress = ETH_ADDRESS;
    //         overrides.value = `0x${assetInAmount.toString(16)}`;
    //     }
    //     if (assetOutAddress === ETH_KEY) {
    //         assetOutAddress = ETH_ADDRESS;
    //     }
    //     const exchangeProxyContract = new Contract(exchangeProxyAddress, ExchangeProxyABI, provider.getSigner());
    //     try {
    //         return await exchangeProxyContract.multihopBatchSwapExactIn(
    //             swaps,
    //             assetInAddress,
    //             assetOutAddress,
    //             assetInAmount.toString(),
    //             assetOutAmountMin.toString(),
    //             overrides,
    //         );
    //     } catch(e) {
    //         if (e.code === ErrorCode.UNPREDICTABLE_GAS_LIMIT) {
    //             const sender = await provider.getSigner().getAddress();
    //             logRevertedTx(
    //                 sender,
    //                 exchangeProxyContract,
    //                 'multihopBatchSwapExactIn',
    //                 [
    //                     swaps,
    //                     assetInAddress,
    //                     assetOutAddress,
    //                     assetInAmount.toString(),
    //                     assetOutAmountMin.toString(),
    //                 ],
    //                 overrides,
    //             );
    //         }
    //         return e;
    //     }
    // }

    // static async swapOut(
    //     provider: Web3Provider,
    //     swaps: Swap[][],
    //     assetInAddress: string,
    //     assetOutAddress: string,
    //     assetInAmountMax: BigNumber,
    // ): Promise<any> {
    //     const overrides: any = {};
    //     if (assetInAddress === ETH_KEY) {
    //         assetInAddress = ETH_ADDRESS;
    //         overrides.value = `0x${assetInAmountMax.toString(16)}`;
    //     }
    //     if (assetOutAddress === ETH_KEY) {
    //         assetOutAddress = ETH_ADDRESS;
    //     }
    //     const exchangeProxyContract = new Contract(exchangeProxyAddress, ExchangeProxyABI, provider.getSigner());
    //     try {
    //         return await exchangeProxyContract.multihopBatchSwapExactOut(
    //             swaps,
    //             assetInAddress,
    //             assetOutAddress,
    //             assetInAmountMax.toString(),
    //             overrides,
    //         );
    //     } catch(e) {
    //         if (e.code === ErrorCode.UNPREDICTABLE_GAS_LIMIT) {
    //             const sender = await provider.getSigner().getAddress();
    //             logRevertedTx(
    //                 sender,
    //                 exchangeProxyContract,
    //                 'multihopBatchSwapExactOut',
    //                 [
    //                     swaps,
    //                     assetInAddress,
    //                     assetOutAddress,
    //                     assetInAmountMax.toString(),
    //                 ],
    //                 overrides,
    //             );
    //         }
    //         return e;
    //     }
    // }
}
