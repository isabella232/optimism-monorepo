/* External Imports */
import { InMemoryProcessingDataService } from '@eth-optimism/core-db'
import {
  BigNumber,
  keccak256FromUtf8,
  sleep,
  ZERO_ADDRESS,
} from '@eth-optimism/core-utils'

import {
  Block,
  JsonRpcProvider,
  Log,
  TransactionResponse,
} from 'ethers/providers'

/* Internal Imports */
import {
  L1ChainDataPersister,
  CHAIN_ID,
  DefaultDataService,
} from '../../src/app'
import {
  LogHandlerContext,
  RollupTransaction,
  L1DataService,
  GethSubmissionRecord,
  L1BlockPersistenceInfo,
} from '../../src/types'

class MockDataService extends DefaultDataService {
  public l1BlockPersistenceInfo: L1BlockPersistenceInfo
  public readonly blocks: Block[] = []
  public readonly processedBlocks: Set<string> = new Set<string>()
  public readonly blockTransactions: Map<string, TransactionResponse[]>
  public readonly stateRoots: Map<string, string[]>
  public readonly rollupTransactions: Map<string, RollupTransaction[]>

  constructor() {
    super(undefined)
    this.blocks = []
    this.processedBlocks = new Set<string>()
    this.blockTransactions = new Map<string, TransactionResponse[]>()
    this.stateRoots = new Map<string, string[]>()
    this.rollupTransactions = new Map<string, RollupTransaction[]>()
    this.l1BlockPersistenceInfo = {
      blockPersisted: false,
      txPersisted: false,
      rollupTxsPersisted: false,
      rollupStateRootsPersisted: false,
    }
  }

  public async getL1BlockPersistenceInfo(
    blockNumber: number
  ): Promise<L1BlockPersistenceInfo> {
    return this.l1BlockPersistenceInfo
  }

  public async insertL1Block(block: Block, processed: boolean): Promise<void> {
    this.blocks.push(block)
    if (processed) {
      this.processedBlocks.add(block.hash)
    }
  }

  public async insertL1BlockAndTransactions(
    block: Block,
    txs: TransactionResponse[],
    processed: boolean
  ): Promise<void> {
    this.blocks.push(block)
    this.blockTransactions.set(block.hash, txs)
    if (processed) {
      this.processedBlocks.add(block.hash)
    }
  }

  public async insertL1RollupStateRoots(
    l1TxHash: string,
    stateRoots: string[]
  ): Promise<number> {
    this.stateRoots.set(l1TxHash, stateRoots)
    return this.stateRoots.size
  }

  public async insertL1RollupTransactions(
    l1TxHash: string,
    rollupTransactions: RollupTransaction[],
    createBatch: boolean = false
  ): Promise<number> {
    this.rollupTransactions.set(l1TxHash, rollupTransactions)
    return this.rollupTransactions.size
  }

  public async updateBlockToProcessed(blockHash: string): Promise<void> {
    this.processedBlocks.add(blockHash)
  }
}

const getLog = (
  topics: string[],
  address: string,
  transactionHash: string = keccak256FromUtf8('tx hash'),
  logIndex: number = 0,
  blockNumber: number = 0,
  blockHash: string = keccak256FromUtf8('block hash')
): Log => {
  return {
    topics,
    transactionHash,
    address,
    blockNumber,
    blockHash,
    transactionIndex: 1,
    removed: false,
    transactionLogIndex: 1,
    data: '',
    logIndex,
  }
}

const getTransactionResponse = (
  hash: string = keccak256FromUtf8('0xdeadb33f')
): TransactionResponse => {
  return {
    data: '0xdeadb33f',
    timestamp: 0,
    hash,
    blockNumber: 0,
    blockHash: keccak256FromUtf8('block hash'),
    gasLimit: new BigNumber(1_000_000, 10) as any,
    confirmations: 1,
    from: ZERO_ADDRESS,
    nonce: 1,
    gasPrice: undefined,
    value: undefined,
    chainId: CHAIN_ID,
    wait: (confirmations) => {
      return undefined
    },
  }
}

const getRollupTransaction = (): RollupTransaction => {
  return {
    indexWithinSubmission: -1,
    target: ZERO_ADDRESS,
    calldata: '0xdeadbeef',
    l1MessageSender: ZERO_ADDRESS,
    l1Timestamp: 0,
    l1BlockNumber: 0,
    l1TxHash: keccak256FromUtf8('0xdeadbeef'),
    l1TxIndex: 0,
    l1TxLogIndex: 0,
    nonce: 0,
    queueOrigin: 0,
  }
}

const getBlock = (hash: string, number: number = 0, timestamp: number = 1) => {
  return {
    number,
    hash,
    parentHash: keccak256FromUtf8('parent derp'),
    timestamp,
    nonce: '0x01',
    difficulty: 99999,
    gasLimit: undefined,
    gasUsed: undefined,
    miner: '',
    extraData: '',
    transactions: [],
  }
}

class MockProvider extends JsonRpcProvider {
  public topicToLogsToReturn: Map<string, Log[]>
  public txsToReturn: Map<string, TransactionResponse>
  constructor() {
    super()
    this.topicToLogsToReturn = new Map<string, Log[]>()
    this.txsToReturn = new Map<string, TransactionResponse>()
  }

  public async getLogs(filter): Promise<Log[]> {
    return this.topicToLogsToReturn.get(filter.topics[0]) || []
  }

  public async getTransaction(hash): Promise<TransactionResponse> {
    return this.txsToReturn.get(hash)
  }
}

const topic = 'derp'
const contractAddress = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
const defaultBlock = getBlock(keccak256FromUtf8('derp'))

const errorLogHandlerContext: LogHandlerContext = {
  topic,
  contractAddress,
  handleLog: async () => {
    throw Error('This should not have been called')
  },
}

describe('L1 Chain Data Persister', () => {
  let chainDataPersister: L1ChainDataPersister
  let processingDataService: InMemoryProcessingDataService
  let dataService: MockDataService
  let provider: MockProvider
  beforeEach(async () => {
    processingDataService = new InMemoryProcessingDataService()
    dataService = new MockDataService()
    provider = new MockProvider()
  })

  it('should persist block but not tx without logs', async () => {
    chainDataPersister = await L1ChainDataPersister.create(
      processingDataService,
      dataService,
      provider,
      []
    )

    const block = getBlock(keccak256FromUtf8('derp'))
    await chainDataPersister.handle(block)

    await sleep(1_000)

    dataService.blocks.length.should.equal(1, `Should always insert blocks!`)
    dataService.blockTransactions.size.should.equal(
      0,
      `Inserted transactions when shouldn't have!`
    )
    dataService.stateRoots.size.should.equal(
      0,
      `Inserted roots when shouldn't have!`
    )
  })

  it('should honor earliest block param -- not process old', async () => {
    chainDataPersister = await L1ChainDataPersister.create(
      processingDataService,
      dataService,
      provider,
      [],
      1
    )

    const block = getBlock(keccak256FromUtf8('derp'))
    await chainDataPersister.handle(block)

    await sleep(1_000)

    dataService.blocks.length.should.equal(0, `Should always insert blocks!`)
    dataService.blockTransactions.size.should.equal(
      0,
      `Inserted transactions when shouldn't have!`
    )
    dataService.stateRoots.size.should.equal(
      0,
      `Inserted roots when shouldn't have!`
    )
  })

  it('should honor earliest block param -- process new', async () => {
    chainDataPersister = await L1ChainDataPersister.create(
      processingDataService,
      dataService,
      provider,
      [],
      1
    )

    const block = getBlock(keccak256FromUtf8('derp'), 1)
    await chainDataPersister.handle(block)

    await sleep(1_000)

    dataService.blocks.length.should.equal(1, `Should always insert blocks!`)
    dataService.blockTransactions.size.should.equal(
      0,
      `Inserted transactions when shouldn't have!`
    )
    dataService.stateRoots.size.should.equal(
      0,
      `Inserted roots when shouldn't have!`
    )
  })

  describe('Irrelevant logs', () => {
    it('should persist block but no txs without log handler', async () => {
      chainDataPersister = await L1ChainDataPersister.create(
        processingDataService,
        dataService,
        provider,
        []
      )

      provider.topicToLogsToReturn.set('derp', [getLog(['derp'], ZERO_ADDRESS)])

      const block = getBlock(keccak256FromUtf8('derp'))
      await chainDataPersister.handle(block)

      await sleep(1_000)

      dataService.blocks.length.should.equal(1, `Should always insert blocks!`)
      dataService.blockTransactions.size.should.equal(
        0,
        `Inserted transactions when shouldn't have!`
      )
      dataService.stateRoots.size.should.equal(
        0,
        `Inserted roots when shouldn't have!`
      )
    })

    it('should persist block but no txs without logs relevant to log handler topic', async () => {
      const logHandlerContext: LogHandlerContext = {
        topic: 'not your topic',
        contractAddress: ZERO_ADDRESS,
        handleLog: async () => {
          throw Error('This should not have been called')
        },
      }
      chainDataPersister = await L1ChainDataPersister.create(
        processingDataService,
        dataService,
        provider,
        [logHandlerContext]
      )

      provider.topicToLogsToReturn.set('derp', [getLog(['derp'], ZERO_ADDRESS)])

      const block = getBlock(keccak256FromUtf8('derp'))
      await chainDataPersister.handle(block)

      await sleep(1_000)

      dataService.blocks.length.should.equal(1, `Should always insert blocks!`)
      dataService.blockTransactions.size.should.equal(
        0,
        `Inserted transactions when shouldn't have!`
      )
      dataService.stateRoots.size.should.equal(
        0,
        `Inserted roots when shouldn't have!`
      )
    })

    it('should persist block but no txs without logs relevant to log handler address', async () => {
      chainDataPersister = await L1ChainDataPersister.create(
        processingDataService,
        dataService,
        provider,
        [errorLogHandlerContext]
      )

      provider.topicToLogsToReturn.set(topic, [getLog([topic], ZERO_ADDRESS)])

      await chainDataPersister.handle(defaultBlock)

      await sleep(1_000)

      dataService.blocks.length.should.equal(1, `Should always insert blocks!`)
      dataService.blockTransactions.size.should.equal(
        0,
        `Inserted transactions when shouldn't have!`
      )
      dataService.stateRoots.size.should.equal(
        0,
        `Inserted roots when shouldn't have!`
      )
    })
  })

  describe('relevant logs', () => {
    const configuredHandlerContext: LogHandlerContext = {
      ...errorLogHandlerContext,
    }
    beforeEach(async () => {
      chainDataPersister = await L1ChainDataPersister.create(
        processingDataService,
        dataService,
        provider,
        [configuredHandlerContext]
      )
    })

    it('should persist block, transaction, and rollup transactions with relevant logs', async () => {
      const rollupTxs = [getRollupTransaction()]
      configuredHandlerContext.handleLog = async (ds, l, t) => {
        await ds.insertL1RollupTransactions(t.hash, rollupTxs)
      }

      const tx: TransactionResponse = getTransactionResponse()
      provider.txsToReturn.set(tx.hash, tx)
      provider.topicToLogsToReturn.set(topic, [
        getLog([topic], contractAddress, tx.hash),
      ])

      await chainDataPersister.handle(defaultBlock)

      await sleep(1_000)

      dataService.blocks.length.should.equal(1, `Should have inserted block!`)
      dataService.blocks[0].should.deep.equal(defaultBlock, `block mismatch!`)

      dataService.blockTransactions.size.should.equal(
        1,
        `Should have inserted transaction!`
      )
      const blockTxsExist: boolean = !!dataService.blockTransactions.get(
        defaultBlock.hash
      )
      blockTxsExist.should.equal(
        true,
        `Should have inserted txs for the block!`
      )
      dataService.blockTransactions
        .get(defaultBlock.hash)
        .length.should.equal(1, `Should have inserted 1 block transaction!`)
      dataService.blockTransactions
        .get(defaultBlock.hash)[0]
        .should.deep.equal(tx, `Should have inserted block transactions!`)

      const rollupTxsExist: boolean = !!dataService.rollupTransactions.get(
        tx.hash
      )
      rollupTxsExist.should.equal(
        true,
        `Should have inserted rollup txs for the tx!`
      )
      dataService.rollupTransactions
        .get(tx.hash)
        .length.should.equal(1, `Should have inserted 1 rollup tx!`)
      dataService.rollupTransactions
        .get(tx.hash)[0]
        .should.deep.equal(rollupTxs[0], `Inserted rollup tx mismatch!`)

      dataService.processedBlocks.size.should.equal(1, `block not processed!`)
      dataService.processedBlocks
        .has(defaultBlock.hash)
        .should.equal(true, `correct block not processed!`)
    })

    it('should persist block, transaction, and state roots with relevant logs', async () => {
      const stateRoots = [keccak256FromUtf8('root')]
      configuredHandlerContext.handleLog = async (ds, l, t) => {
        await ds.insertL1RollupStateRoots(t.hash, stateRoots)
      }

      const tx: TransactionResponse = getTransactionResponse()
      provider.txsToReturn.set(tx.hash, tx)
      provider.topicToLogsToReturn.set(topic, [
        getLog([topic], contractAddress, tx.hash),
      ])

      await chainDataPersister.handle(defaultBlock)

      await sleep(1_000)

      dataService.blocks.length.should.equal(1, `Should have inserted block!`)
      dataService.blocks[0].should.deep.equal(defaultBlock, `block mismatch!`)

      dataService.blockTransactions.size.should.equal(
        1,
        `Should have inserted transaction!`
      )
      const blockTxsExist: boolean = !!dataService.blockTransactions.get(
        defaultBlock.hash
      )
      blockTxsExist.should.equal(
        true,
        `Should have inserted txs for the block!`
      )
      dataService.blockTransactions
        .get(defaultBlock.hash)
        .length.should.equal(1, `Should have inserted 1 block transaction!`)
      dataService.blockTransactions
        .get(defaultBlock.hash)[0]
        .should.deep.equal(tx, `Should have inserted block transactions!`)

      const stateRootsExist: boolean = !!dataService.stateRoots.get(tx.hash)
      stateRootsExist.should.equal(
        true,
        `Should have inserted state roots for the tx!`
      )
      dataService.stateRoots
        .get(tx.hash)
        .length.should.equal(1, `Should have inserted 1 state root!`)
      dataService.stateRoots
        .get(tx.hash)[0]
        .should.deep.equal(stateRoots[0], `Inserted state Root mismatch!`)

      dataService.processedBlocks.size.should.equal(1, `block not processed!`)
      dataService.processedBlocks
        .has(defaultBlock.hash)
        .should.equal(true, `correct block not processed!`)
    })

    it('should persist block, transaction, rollup transactions, and state roots with relevant logs -- single tx', async () => {
      const rollupTxs = [getRollupTransaction()]
      const stateRoots = [keccak256FromUtf8('root')]
      configuredHandlerContext.handleLog = async (ds, l, t) => {
        await ds.insertL1RollupStateRoots(t.hash, stateRoots)
      }
      const topic2 = 'derp_derp'
      chainDataPersister = await L1ChainDataPersister.create(
        processingDataService,
        dataService,
        provider,
        [
          configuredHandlerContext,
          {
            topic: topic2,
            contractAddress,
            handleLog: async (ds, l, t) => {
              await ds.insertL1RollupTransactions(t.hash, rollupTxs)
            },
          },
        ]
      )

      const tx: TransactionResponse = getTransactionResponse()
      provider.txsToReturn.set(tx.hash, tx)
      provider.topicToLogsToReturn.set(topic2, [
        getLog([topic, topic2], contractAddress, tx.hash),
      ])

      await chainDataPersister.handle(defaultBlock)

      await sleep(1_000)

      dataService.blocks.length.should.equal(1, `Should have inserted block!`)
      dataService.blocks[0].should.deep.equal(defaultBlock, `block mismatch!`)

      dataService.blockTransactions.size.should.equal(
        1,
        `Should have inserted transaction!`
      )
      const blockTxsExist: boolean = !!dataService.blockTransactions.get(
        defaultBlock.hash
      )
      blockTxsExist.should.equal(
        true,
        `Should have inserted txs for the block!`
      )
      dataService.blockTransactions
        .get(defaultBlock.hash)
        .length.should.equal(1, `Should have inserted 1 block transaction!`)
      dataService.blockTransactions
        .get(defaultBlock.hash)[0]
        .should.deep.equal(tx, `Should have inserted block transactions!`)

      const stateRootsExist: boolean = !!dataService.stateRoots.get(tx.hash)
      stateRootsExist.should.equal(
        true,
        `Should have inserted state roots for the tx!`
      )
      dataService.stateRoots
        .get(tx.hash)
        .length.should.equal(1, `Should have inserted 1 state root!`)
      dataService.stateRoots
        .get(tx.hash)[0]
        .should.deep.equal(stateRoots[0], `Inserted state Root mismatch!`)

      dataService.processedBlocks.size.should.equal(1, `block not processed!`)
      dataService.processedBlocks
        .has(defaultBlock.hash)
        .should.equal(true, `correct block not processed!`)

      const rollupTxsExist: boolean = !!dataService.rollupTransactions.get(
        tx.hash
      )
      rollupTxsExist.should.equal(
        true,
        `Should have inserted rollup txs for the tx!`
      )
      dataService.rollupTransactions
        .get(tx.hash)
        .length.should.equal(1, `Should have inserted 1 rollup tx!`)
      dataService.rollupTransactions
        .get(tx.hash)[0]
        .should.deep.equal(rollupTxs[0], `Inserted rollup tx mismatch!`)
    })

    it('should persist block, transaction, rollup transactions, and state roots with relevant logs -- separate txs', async () => {
      const rollupTxs = [getRollupTransaction()]
      const stateRoots = [keccak256FromUtf8('root')]
      configuredHandlerContext.handleLog = async (ds, l, t) => {
        await ds.insertL1RollupStateRoots(tx.hash, stateRoots)
      }
      const topic2 = 'derp_derp'
      chainDataPersister = await L1ChainDataPersister.create(
        processingDataService,
        dataService,
        provider,
        [
          configuredHandlerContext,
          {
            topic: topic2,
            contractAddress,
            handleLog: async (ds, l, t) => {
              await ds.insertL1RollupTransactions(t.hash, rollupTxs)
            },
          },
        ]
      )

      const tx: TransactionResponse = getTransactionResponse()
      const tx2: TransactionResponse = getTransactionResponse(
        keccak256FromUtf8('tx2')
      )
      provider.txsToReturn.set(tx.hash, tx)
      provider.txsToReturn.set(tx2.hash, tx2)
      provider.topicToLogsToReturn.set(topic, [
        getLog([topic], contractAddress, tx.hash),
      ])
      provider.topicToLogsToReturn.set(topic2, [
        getLog([topic2], contractAddress, tx2.hash),
      ])

      await chainDataPersister.handle(defaultBlock)

      await sleep(1_000)

      dataService.blocks.length.should.equal(1, `Should have inserted block!`)
      dataService.blocks[0].should.deep.equal(defaultBlock, `block mismatch!`)

      dataService.blockTransactions.size.should.equal(
        1,
        `Should have inserted transactions for 1 block!`
      )
      const blockTxsExist: boolean = !!dataService.blockTransactions.get(
        defaultBlock.hash
      )
      blockTxsExist.should.equal(
        true,
        `Should have inserted txs for the block!`
      )
      dataService.blockTransactions
        .get(defaultBlock.hash)
        .length.should.equal(2, `Should have inserted 2 block transactions!`)
      dataService.blockTransactions
        .get(defaultBlock.hash)[0]
        .should.deep.equal(tx, `Should have inserted block transaction 1!`)
      dataService.blockTransactions
        .get(defaultBlock.hash)[1]
        .should.deep.equal(tx2, `Should have inserted block transaction 2!`)

      const stateRootsExist: boolean = !!dataService.stateRoots.get(tx.hash)
      stateRootsExist.should.equal(
        true,
        `Should have inserted state roots for the tx!`
      )
      dataService.stateRoots
        .get(tx.hash)
        .length.should.equal(1, `Should have inserted 1 state root!`)
      dataService.stateRoots
        .get(tx.hash)[0]
        .should.deep.equal(stateRoots[0], `Inserted state Root mismatch!`)

      dataService.processedBlocks.size.should.equal(1, `block not processed!`)
      dataService.processedBlocks
        .has(defaultBlock.hash)
        .should.equal(true, `correct block not processed!`)

      const rollupTxsExist: boolean = !!dataService.rollupTransactions.get(
        tx2.hash
      )
      rollupTxsExist.should.equal(
        true,
        `Should have inserted rollup txs for the tx!`
      )
      dataService.rollupTransactions
        .get(tx2.hash)
        .length.should.equal(1, `Should have inserted 1 rollup tx!`)
      dataService.rollupTransactions
        .get(tx2.hash)[0]
        .should.deep.equal(rollupTxs[0], `Inserted rollup tx mismatch!`)
    })

    describe('multiple blocks', () => {
      it('should only persist relevant transaction, and rollup transactions with relevant logs', async () => {
        const rollupTxs = [getRollupTransaction()]
        configuredHandlerContext.handleLog = async (ds, l, t) => {
          await ds.insertL1RollupTransactions(tx.hash, rollupTxs)
        }

        const tx: TransactionResponse = getTransactionResponse()
        provider.txsToReturn.set(tx.hash, tx)

        const blockOne = getBlock(keccak256FromUtf8('first'))

        await chainDataPersister.handle(blockOne)

        await sleep(1_000)

        provider.topicToLogsToReturn.set(topic, [
          getLog([topic], contractAddress, tx.hash),
        ])

        const blockTwo = { ...defaultBlock }
        blockTwo.number = 1
        await chainDataPersister.handle(blockTwo)

        await sleep(1_000)

        dataService.blocks.length.should.equal(2, `Should have inserted block!`)
        dataService.blocks[1].should.deep.equal(blockTwo, `block mismatch!`)

        dataService.blockTransactions.size.should.equal(
          1,
          `Should have transactions for a single block!`
        )
        const blockOneTxsExist: boolean = !!dataService.blockTransactions.get(
          blockOne.hash
        )
        blockOneTxsExist.should.equal(
          false,
          `Should not have inserted txs for blockOne!`
        )

        const blockTwoTxsExist: boolean = !!dataService.blockTransactions.get(
          blockTwo.hash
        )
        blockTwoTxsExist.should.equal(
          true,
          `Should have inserted txs for blockTwo!`
        )

        dataService.blockTransactions
          .get(blockTwo.hash)
          .length.should.equal(1, `Should have inserted 1 block transaction!`)
        dataService.blockTransactions
          .get(blockTwo.hash)[0]
          .should.deep.equal(tx, `Should have inserted block transactions!`)

        const rollupTxsExist: boolean = !!dataService.rollupTransactions.get(
          tx.hash
        )
        rollupTxsExist.should.equal(
          true,
          `Should have inserted rollup txs for the tx!`
        )
        dataService.rollupTransactions
          .get(tx.hash)
          .length.should.equal(1, `Should have inserted 1 rollup tx!`)
        dataService.rollupTransactions
          .get(tx.hash)[0]
          .should.deep.equal(rollupTxs[0], `Inserted rollup tx mismatch!`)

        dataService.processedBlocks.size.should.equal(2, `block not processed!`)
      })
    })
  })

  describe('Partial state persisted', () => {
    it('should not persist block if already persisted', async () => {
      chainDataPersister = await L1ChainDataPersister.create(
        processingDataService,
        dataService,
        provider,
        []
      )

      provider.topicToLogsToReturn.set('derp', [getLog(['derp'], ZERO_ADDRESS)])

      dataService.l1BlockPersistenceInfo.blockPersisted = true
      const block = getBlock(keccak256FromUtf8('derp'))
      await chainDataPersister.handle(block)

      await sleep(1_000)

      dataService.blocks.length.should.equal(0, `Should not re-insert block!`)
      dataService.blockTransactions.size.should.equal(
        0,
        `Inserted transactions when shouldn't have!`
      )
      dataService.stateRoots.size.should.equal(
        0,
        `Inserted roots when shouldn't have!`
      )
    })

    describe('with logs', () => {
      const configuredHandlerContext: LogHandlerContext = {
        ...errorLogHandlerContext,
      }
      beforeEach(async () => {
        chainDataPersister = await L1ChainDataPersister.create(
          processingDataService,
          dataService,
          provider,
          [configuredHandlerContext]
        )
      })

      it('should not persist block or l1 transaction if already persisted but should persist logs', async () => {
        const rollupTxs = [getRollupTransaction()]
        configuredHandlerContext.handleLog = async (ds, l, t) => {
          await ds.insertL1RollupTransactions(t.hash, rollupTxs)
        }

        const tx: TransactionResponse = getTransactionResponse()
        provider.txsToReturn.set(tx.hash, tx)
        provider.topicToLogsToReturn.set(topic, [
          getLog([topic], contractAddress, tx.hash),
        ])

        dataService.l1BlockPersistenceInfo.blockPersisted = true

        await chainDataPersister.handle(defaultBlock)

        await sleep(1_000)

        dataService.blocks.length.should.equal(
          0,
          `Should not have inserted block because it already exists!`
        )
        dataService.blockTransactions.size.should.equal(
          0,
          `Should not have inserted transaction because it already exists!`
        )

        const rollupTxsExist: boolean = !!dataService.rollupTransactions.get(
          tx.hash
        )
        rollupTxsExist.should.equal(
          true,
          `Should have inserted rollup txs for the tx!`
        )
        dataService.rollupTransactions
          .get(tx.hash)
          .length.should.equal(1, `Should have inserted 1 rollup tx!`)
        dataService.rollupTransactions
          .get(tx.hash)[0]
          .should.deep.equal(rollupTxs[0], `Inserted rollup tx mismatch!`)

        dataService.processedBlocks.size.should.equal(1, `block not processed!`)
        dataService.processedBlocks
          .has(defaultBlock.hash)
          .should.equal(true, `correct block not processed!`)
      })

      it('should not persist block, transaction or rollup transaction it is all already stored', async () => {
        const rollupTxs = [getRollupTransaction()]
        configuredHandlerContext.handleLog = async (ds, l, t) => {
          await ds.insertL1RollupTransactions(t.hash, rollupTxs)
        }

        const tx: TransactionResponse = getTransactionResponse()
        provider.txsToReturn.set(tx.hash, tx)
        provider.topicToLogsToReturn.set(topic, [
          getLog([topic], contractAddress, tx.hash),
        ])

        dataService.l1BlockPersistenceInfo.blockPersisted = true
        dataService.l1BlockPersistenceInfo.rollupTxsPersisted = true

        await chainDataPersister.handle(defaultBlock)

        await sleep(1_000)

        dataService.blocks.length.should.equal(
          0,
          `Should not have inserted block because it already exists!`
        )
        dataService.blockTransactions.size.should.equal(
          0,
          `Should not have inserted transaction because it already exists!`
        )

        const rollupTxsExist: boolean = !!dataService.rollupTransactions.get(
          tx.hash
        )
        rollupTxsExist.should.equal(
          false,
          `Should not have inserted rollup txs for the tx because they already exist!`
        )
        dataService.processedBlocks.size.should.equal(
          0,
          `block should not be marked processed because it already is!`
        )
      })

      it('should not persist block or transaction but should persist state roots', async () => {
        const stateRoots = [keccak256FromUtf8('root')]
        configuredHandlerContext.handleLog = async (ds, l, t) => {
          await ds.insertL1RollupStateRoots(tx.hash, stateRoots)
        }
        chainDataPersister = await L1ChainDataPersister.create(
          processingDataService,
          dataService,
          provider,
          [configuredHandlerContext]
        )

        const tx: TransactionResponse = getTransactionResponse()
        const tx2: TransactionResponse = getTransactionResponse(
          keccak256FromUtf8('tx2')
        )
        provider.txsToReturn.set(tx.hash, tx)
        provider.txsToReturn.set(tx2.hash, tx2)
        provider.topicToLogsToReturn.set(topic, [
          getLog([topic], contractAddress, tx.hash),
        ])

        dataService.l1BlockPersistenceInfo.blockPersisted = true

        await chainDataPersister.handle(defaultBlock)

        await sleep(1_000)

        dataService.blocks.length.should.equal(
          0,
          `Should not have inserted block because it already exists!`
        )
        dataService.blockTransactions.size.should.equal(
          0,
          `Should not have inserted transactions for 1 block because it already exists!`
        )

        const stateRootsExist: boolean = !!dataService.stateRoots.get(tx.hash)
        stateRootsExist.should.equal(
          true,
          `Should have inserted state roots for the tx!`
        )
        dataService.stateRoots
          .get(tx.hash)
          .length.should.equal(1, `Should have inserted 1 state root!`)
        dataService.stateRoots
          .get(tx.hash)[0]
          .should.deep.equal(stateRoots[0], `Inserted state Root mismatch!`)

        dataService.processedBlocks.size.should.equal(1, `block not processed!`)
        dataService.processedBlocks
          .has(defaultBlock.hash)
          .should.equal(true, `correct block not processed!`)
      })

      it('should not persist block, transaction, or state roots if they are already persisted', async () => {
        const stateRoots = [keccak256FromUtf8('root')]
        configuredHandlerContext.handleLog = async (ds, l, t) => {
          await ds.insertL1RollupStateRoots(tx.hash, stateRoots)
        }
        chainDataPersister = await L1ChainDataPersister.create(
          processingDataService,
          dataService,
          provider,
          [configuredHandlerContext]
        )

        const tx: TransactionResponse = getTransactionResponse()
        const tx2: TransactionResponse = getTransactionResponse(
          keccak256FromUtf8('tx2')
        )
        provider.txsToReturn.set(tx.hash, tx)
        provider.txsToReturn.set(tx2.hash, tx2)
        provider.topicToLogsToReturn.set(topic, [
          getLog([topic], contractAddress, tx.hash),
        ])

        dataService.l1BlockPersistenceInfo.blockPersisted = true
        dataService.l1BlockPersistenceInfo.rollupStateRootsPersisted = true

        await chainDataPersister.handle(defaultBlock)

        await sleep(1_000)

        dataService.blocks.length.should.equal(
          0,
          `Should not have inserted block because it already exists!`
        )
        dataService.blockTransactions.size.should.equal(
          0,
          `Should not have inserted transactions for 1 block because it already exists!`
        )

        const stateRootsExist: boolean = !!dataService.stateRoots.get(tx.hash)
        stateRootsExist.should.equal(
          false,
          `Should not have inserted state roots for the tx because they already exist!`
        )
        dataService.processedBlocks.size.should.equal(
          0,
          `block should not be marked processed because it already is!`
        )
      })
    })
  })
})
