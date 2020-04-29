require('module-alias/register')
import * as ethers from 'ethers'
import * as argparse from 'argparse' 
import * as fs from 'fs' 
import * as path from 'path'
import * as etherlime from 'etherlime-lib'
import { config } from 'maci-config'
import { genPubKey, bigInt } from 'maci-crypto'
import { PubKey } from 'maci-domainobjs'
import { genAccounts, genTestAccounts } from './accounts'
const MiMC = require('@maci-contracts/compiled/MiMC.json')
const Hasher = require('@maci-contracts/compiled/Hasher.json')
const SignUpToken = require('@maci-contracts/compiled/SignUpToken.json')
const SignUpTokenGatekeeper = require('@maci-contracts/compiled/SignUpTokenGatekeeper.json')
const FreeForAllSignUpGatekeeper = require('@maci-contracts/compiled/FreeForAllGatekeeper.json')
const InitialVoiceCreditProxy = require('@maci-contracts/compiled/InitialVoiceCreditProxy.json')
const ConstantInitialVoiceCreditProxy = require('@maci-contracts/compiled/ConstantInitialVoiceCreditProxy.json')
const BatchUpdateStateTreeVerifier = require('@maci-contracts/compiled/BatchUpdateStateTreeVerifier.json')
const QuadVoteTallyVerifier = require('@maci-contracts/compiled/QuadVoteTallyVerifier.json')
const MACI = require('@maci-contracts/compiled/MACI.json')

const coordinatorPublicKey = genPubKey(bigInt(config.maci.coordinatorPrivKey))

const maciContractAbi = MACI.abi
const initialVoiceCreditProxyAbi = InitialVoiceCreditProxy.abi

const genProvider = (
    rpcUrl: string = config.get('chain.url'),
) => {

    return new ethers.providers.JsonRpcProvider(rpcUrl)
}

const genJsonRpcDeployer = (
    privateKey: string,
    url: string,
) => {

    return new etherlime.JSONRPCPrivateKeyDeployer(
        privateKey,
        url,
    )
}

const genDeployer = (
    privateKey: string,
) => {
    return new etherlime.EtherlimeGanacheDeployer(
        privateKey,
        config.get('chain.ganache.port'),
        {
            gasLimit: 10000000,
        },
    )
}

const deployConstantInitialVoiceCreditProxy = async (
    deployer,
    amount: number,
    quiet: boolean = false
) => {
    log('Deploying InitialVoiceCreditProxy', quiet)
    return await deployer.deploy(ConstantInitialVoiceCreditProxy, {}, amount)
}

const deploySignupToken = async (deployer) => {
    console.log('Deploying SignUpToken')
    return await deployer.deploy(SignUpToken, {})
}

const deploySignupTokenGatekeeper = async (
    deployer,
    signUpTokenAddress: string,
    quiet: boolean = false
) => {
    log('Deploying SignUpTokenGatekeeper', quiet)
    const signUpTokenGatekeeperContract = await deployer.deploy(
        SignUpTokenGatekeeper,
        {},
        signUpTokenAddress,
    )

    return signUpTokenGatekeeperContract
}

const deployFreeForAllSignUpGatekeeper = async (
    deployer,
    quiet: boolean = false
) => {
    log('Deploying FreeForAllSignUpGatekeeper', quiet)
    return await deployer.deploy(
        FreeForAllSignUpGatekeeper,
        {},
    )
}

const log = (msg: string, quiet: boolean) => {
    if (!quiet) {
        console.log(msg)
    }
}

const deployMaci = async (
    deployer,
    signUpGatekeeperAddress: string,
    initialVoiceCreditProxy: string,
    stateTreeDepth: number = config.maci.merkleTrees.stateTreeDepth,
    messageTreeDepth: number = config.maci.merkleTrees.messageTreeDepth,
    voteOptionTreeDepth: number = config.maci.merkleTrees.voteOptionTreeDepth,
    quadVoteTallyBatchSize: number = config.maci.quadVoteTallyBatchSize,
    messageBatchSize: number = config.maci.messageBatchSize,
    voteOptionsMaxLeafIndex: number = config.maci.voteOptionsMaxLeafIndex,
    signUpDurationInSeconds: number = config.maci.signUpDurationInSeconds,
    votingDurationInSeconds: number = config.maci.votingDurationInSeconds,
    coordinatorPubKey?: PubKey,
    quiet: boolean = false,
) => {
    log('Deploying MiMC', quiet)

    if (!coordinatorPubKey) {
        const p = genPubKey(bigInt(config.maci.coordinatorPrivKey))
        coordinatorPubKey = new PubKey(p)
    }

    const mimcContract = await deployer.deploy(MiMC, {})

    log('Deploying BatchUpdateStateTreeVerifier', quiet)
    const batchUstVerifierContract = await deployer.deploy(BatchUpdateStateTreeVerifier, {})

    log('Deploying QuadVoteTallyVerifier', quiet)
    const quadVoteTallyVerifierContract = await deployer.deploy(QuadVoteTallyVerifier, {})

    log('Deploying MACI', quiet)

    const maxUsers = (bigInt(2).pow(bigInt(stateTreeDepth)) - bigInt(1)).toString()
    const maxMessages = (bigInt(2).pow(bigInt(messageTreeDepth)) - bigInt(1)).toString()

    const maciContract = await deployer.deploy(
        MACI,
        { MiMC: mimcContract.contractAddress },
        { stateTreeDepth, messageTreeDepth, voteOptionTreeDepth },
        {
            tallyBatchSize: quadVoteTallyBatchSize,
            messageBatchSize: messageBatchSize,
        },
        {
            maxUsers,
            maxMessages,
            maxVoteOptions: voteOptionsMaxLeafIndex,
        },
        signUpGatekeeperAddress,
        batchUstVerifierContract.contractAddress,
        quadVoteTallyVerifierContract.contractAddress,
        signUpDurationInSeconds,
        votingDurationInSeconds,
        initialVoiceCreditProxy,
        {
            x: coordinatorPubKey.rawPubKey[0].toString(),
            y: coordinatorPubKey.rawPubKey[1].toString(),
        },
    )

    return {
        batchUstVerifierContract,
        quadVoteTallyVerifierContract,
        mimcContract,
        maciContract,
    }
}

const main = async () => {
    let accounts
    if (config.env === 'local-dev' || config.env === 'test') {
        accounts = genTestAccounts(1)
    } else {
        accounts = genAccounts()
    }
    const admin = accounts[0]

    console.log('Using account', admin.address)

    const parser = new argparse.ArgumentParser({ 
        description: 'Deploy all contracts to an Ethereum network of your choice'
    })

    parser.addArgument(
        ['-o', '--output'],
        {
            help: 'The filepath to save the addresses of the deployed contracts',
            required: true
        }
    )

    parser.addArgument(
        ['-s', '--signUpToken'],
        {
            help: 'The address of the signup token (e.g. POAP)',
            required: false
        }
    )

    parser.addArgument(
        ['-p', '--initialVoiceCreditProxy'],
        {
            help: 'The address of the contract which provides the initial voice credit balance',
            required: false
        }
    )

    const args = parser.parseArgs()
    const outputAddressFile = args.output
    const signUpToken = args.signUpToken
    const initialVoiceCreditProxy = args.initialVoiceCreditProxy

    const deployer = genDeployer(admin.privateKey)

    let signUpTokenAddress
    let signUpTokenGatekeeperAddress
    if (signUpToken) {
        signUpTokenAddress = signUpToken
    } else {
        const signUpTokenContract = await deploySignupToken(deployer)
        signUpTokenAddress = signUpTokenContract.contractAddress
    }

    let initialVoiceCreditBalanceAddress
    if (initialVoiceCreditProxy) {
        initialVoiceCreditBalanceAddress = initialVoiceCreditProxy
    } else {
        const initialVoiceCreditProxyContract = await deployConstantInitialVoiceCreditProxy(
            deployer,
            config.maci.initialVoiceCreditBalance,
        )
        initialVoiceCreditBalanceAddress = initialVoiceCreditProxyContract.contractAddress
    }

    const signUpTokenGatekeeperContract = await deploySignupTokenGatekeeper(
        deployer,
        signUpTokenAddress,
    )

    const {
        mimcContract,
        maciContract,
        batchUstVerifierContract,
        quadVoteTallyVerifierContract,
    } = await deployMaci(
        deployer,
        signUpTokenGatekeeperContract.contractAddress,
        initialVoiceCreditBalanceAddress,
    )

    const addresses = {
        MiMC: mimcContract.contractAddress,
        BatchUpdateStateTreeVerifier: batchUstVerifierContract.contractAddress,
        QuadraticVoteTallyVerifier: quadVoteTallyVerifierContract.contractAddress,
        MACI: maciContract.contractAddress,
    }

    const addressJsonPath = path.join(__dirname, '..', outputAddressFile)
    fs.writeFileSync(
        addressJsonPath,
        JSON.stringify(addresses),
    )

    console.log(addresses)
}

if (require.main === module) {
    try {
        main()
    } catch (err) {
        console.error(err)
    }
}

export {
    deployMaci,
    deploySignupToken,
    deploySignupTokenGatekeeper,
    deployConstantInitialVoiceCreditProxy,
    deployFreeForAllSignUpGatekeeper,
    genDeployer,
    genProvider,
    genJsonRpcDeployer,
    maciContractAbi,
    initialVoiceCreditProxyAbi,
}