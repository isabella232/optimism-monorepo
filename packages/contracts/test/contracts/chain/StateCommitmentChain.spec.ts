import '../../setup'

/* External Imports */
import { ethers } from '@nomiclabs/buidler'
import {
  getLogger,
  padToLength,
  sleep,
  TestUtils,
} from '@eth-optimism/core-utils'
import { Contract, Signer, ContractFactory } from 'ethers'

/* Internal Imports */
import {
  makeRandomBatchOfSize,
  StateChainBatch,
  makeAddressResolver,
  deployAndRegister,
  AddressResolverMapping,
} from '../../test-helpers'

/* Logging */
const log = getLogger('state-commitment-chain', true)

/* Tests */
describe('StateCommitmentChain', () => {
  const DEFAULT_STATE_BATCH = [
    padToLength('0x1234', 64),
    padToLength('0x5678', 64),
  ]
  const DEFAULT_TX_BATCH = [
    '0x1234',
    '0x5678',
    '0x1234',
    '0x5678',
    '0x1234',
    '0x5678',
    '0x1234',
    '0x5678',
    '0x1234',
    '0x5678',
  ]
  const FORCE_INCLUSION_PERIOD = 4000

  let wallet: Signer
  let sequencer: Signer
  let l1ToL2TransactionPasser: Signer
  let fraudVerifier: Signer
  let randomWallet: Signer
  before(async () => {
    ;[
      wallet,
      sequencer,
      l1ToL2TransactionPasser,
      fraudVerifier,
      randomWallet,
    ] = await ethers.getSigners()
  })

  let stateChain: Contract
  let canonicalTxChain: Contract

  const appendAndGenerateStateBatch = async (
    batch: string[],
    batchIndex: number = 0,
    cumulativePrevElements: number = 0
  ): Promise<StateChainBatch> => {
    await stateChain.appendStateBatch(batch, cumulativePrevElements)
    // Generate a local version of the rollup batch
    const localBatch = new StateChainBatch(
      batchIndex,
      cumulativePrevElements,
      batch
    )
    await localBatch.generateTree()
    return localBatch
  }

  const appendTxBatch = async (
    batch: string[],
    txStartIndex: number
  ): Promise<void> => {
    const blockNumber = await canonicalTxChain.provider.getBlockNumber()
    const timestamp = Math.floor(Date.now() / 1000)
    // Submit the rollup batch on-chain
    await canonicalTxChain
      .connect(sequencer)
      .appendSequencerBatch(batch, timestamp, blockNumber, txStartIndex)
  }

  let resolver: AddressResolverMapping
  before(async () => {
    resolver = await makeAddressResolver(wallet)
  })

  let CanonicalTransactionChain: ContractFactory
  let StateCommitmentChain: ContractFactory
  before(async () => {
    CanonicalTransactionChain = await ethers.getContractFactory(
      'CanonicalTransactionChain'
    )
    StateCommitmentChain = await ethers.getContractFactory(
      'StateCommitmentChain'
    )
  })

  before(async () => {
    canonicalTxChain = await deployAndRegister(
      resolver.addressResolver,
      wallet,
      'CanonicalTransactionChain',
      {
        factory: CanonicalTransactionChain,
        params: [
          resolver.addressResolver.address,
          await sequencer.getAddress(),
          FORCE_INCLUSION_PERIOD,
        ],
      }
    )

    await appendTxBatch(DEFAULT_TX_BATCH, 0)
    await resolver.addressResolver.setAddress(
      'FraudVerifier',
      await fraudVerifier.getAddress()
    )
  })

  beforeEach(async () => {
    stateChain = await deployAndRegister(
      resolver.addressResolver,
      wallet,
      'StateCommitmentChain',
      {
        factory: StateCommitmentChain,
        params: [resolver.addressResolver.address],
      }
    )
  })

  describe('appendStateBatch()', async () => {
    it('should allow appending of state batches from any wallet', async () => {
      await stateChain
        .connect(randomWallet)
        .appendStateBatch(DEFAULT_STATE_BATCH, 0)
    })

    it('should throw if submitting an empty batch', async () => {
      const emptyBatch = []
      await TestUtils.assertRevertsAsync(async () => {
        await stateChain.appendStateBatch(emptyBatch, 0)
      }, 'Cannot submit an empty state commitment batch')
    })

    it('should add to batches array', async () => {
      await stateChain.appendStateBatch(DEFAULT_STATE_BATCH, 0)
      const batchesLength = await stateChain.getBatchesLength()
      batchesLength.toNumber().should.equal(1)
    })

    it('should update cumulativeNumElements correctly', async () => {
      await stateChain.appendStateBatch(DEFAULT_STATE_BATCH, 0)
      const cumulativeNumElements = await stateChain.cumulativeNumElements.call()
      cumulativeNumElements.toNumber().should.equal(DEFAULT_STATE_BATCH.length)
    })

    it('should calculate batchHeaderHash correctly', async () => {
      const localBatch = await appendAndGenerateStateBatch(DEFAULT_STATE_BATCH)
      const expectedBatchHeaderHash = await localBatch.hashBatchHeader()
      const calculatedBatchHeaderHash = await stateChain.batches(0)
      calculatedBatchHeaderHash.should.equal(expectedBatchHeaderHash)
    })

    it('should add multiple batches correctly', async () => {
      const numBatches = 3
      let expectedNumElements = 0
      for (let batchIndex = 0; batchIndex < numBatches; batchIndex++) {
        const batch = makeRandomBatchOfSize(batchIndex + 1)
        const cumulativePrevElements = expectedNumElements
        const localBatch = await appendAndGenerateStateBatch(
          batch,
          batchIndex,
          cumulativePrevElements
        )
        const expectedBatchHeaderHash = await localBatch.hashBatchHeader()
        const calculatedBatchHeaderHash = await stateChain.batches(batchIndex)
        calculatedBatchHeaderHash.should.equal(expectedBatchHeaderHash)
        expectedNumElements += batch.length
      }
      const cumulativeNumElements = await stateChain.cumulativeNumElements.call()
      cumulativeNumElements.toNumber().should.equal(expectedNumElements)
      const batchesLength = await stateChain.getBatchesLength()
      batchesLength.toNumber().should.equal(numBatches)
    })

    it('should throw if submitting more state commitments than number of txs in canonical tx chain', async () => {
      const numBatches = 5
      for (let i = 0; i < numBatches; i++) {
        await stateChain.appendStateBatch(
          DEFAULT_STATE_BATCH,
          i * DEFAULT_STATE_BATCH.length
        )
      }
      await TestUtils.assertRevertsAsync(async () => {
        await stateChain.appendStateBatch(
          DEFAULT_STATE_BATCH,
          numBatches * DEFAULT_STATE_BATCH.length
        )
      }, 'Cannot append more state commitments than total number of transactions in CanonicalTransactionChain')
    })

    it('should disregard first few state roots of batch if they have already been appended', async () => {
      const firstBatch = makeRandomBatchOfSize(2)
      const firstLocalBatch = await appendAndGenerateStateBatch(
        firstBatch,
        0,
        0
      )
      const firstBatchHeaderHashExpected = await firstLocalBatch.hashBatchHeader()
      const calculatedFirstBatchHeaderHash = await stateChain.batches(0)
      calculatedFirstBatchHeaderHash.should.equal(firstBatchHeaderHashExpected)

      const secondBatch = makeRandomBatchOfSize(5)
      const secondLocalBatch = await appendAndGenerateStateBatch(
        secondBatch.slice(2),
        1,
        2
      )
      const secondBatchHeaderHashExpected = await secondLocalBatch.hashBatchHeader()
      const calculatedSecondBatchHeaderHash = await stateChain.batches(1)
      calculatedSecondBatchHeaderHash.should.equal(
        secondBatchHeaderHashExpected
      )

      const cumulativeNumElements = await stateChain.cumulativeNumElements.call()
      cumulativeNumElements.toNumber().should.equal(5)
      const batchesLength = await stateChain.getBatchesLength()
      batchesLength.toNumber().should.equal(2)
    })

    it('should not fail or append duplicate batch', async () => {
      const firstBatch = makeRandomBatchOfSize(2)
      const firstLocalBatch = await appendAndGenerateStateBatch(
        firstBatch,
        0,
        0
      )
      const firstBatchHeaderHashExpected = await firstLocalBatch.hashBatchHeader()
      const calculatedFirstBatchHeaderHash = await stateChain.batches(0)
      calculatedFirstBatchHeaderHash.should.equal(firstBatchHeaderHashExpected)

      const secondLocalBatch = await appendAndGenerateStateBatch(
        firstBatch,
        0,
        0
      )

      const cumulativeNumElements = await stateChain.cumulativeNumElements.call()
      cumulativeNumElements.toNumber().should.equal(2)
      const batchesLength = await stateChain.getBatchesLength()
      batchesLength.toNumber().should.equal(1)
    })

    it('should fail append future root index', async () => {
      await TestUtils.assertRevertsAsync(async () => {
        await stateChain.appendStateBatch(makeRandomBatchOfSize(2), 1)
      }, '_startsAtRootIndex index indicates future state root')
    })
  })

  describe('verifyElement() ', async () => {
    it('should return true for valid elements for different batches and elements', async () => {
      // add enough transaction batches so # txs > # state roots
      await appendTxBatch(DEFAULT_TX_BATCH, DEFAULT_TX_BATCH.length)

      const numBatches = 4
      let cumulativePrevElements = 0
      for (let batchIndex = 0; batchIndex < numBatches; batchIndex++) {
        const batchSize = batchIndex * batchIndex + 1 // 1, 2, 5, 10
        const batch = makeRandomBatchOfSize(batchSize)
        const localBatch = await appendAndGenerateStateBatch(
          batch,
          batchIndex,
          cumulativePrevElements
        )
        cumulativePrevElements += batchSize
        for (
          let elementIndex = 0;
          elementIndex < batch.length;
          elementIndex++
        ) {
          const element = batch[elementIndex]
          const position = localBatch.getPosition(elementIndex)
          const elementInclusionProof = await localBatch.getElementInclusionProof(
            elementIndex
          )
          const isIncluded = await stateChain.verifyElement(
            element,
            position,
            elementInclusionProof
          )
          isIncluded.should.equal(true)
        }
      }
    })

    it('should return false for wrong position with wrong indexInBatch', async () => {
      const batch = [
        padToLength('0x1234', 64),
        padToLength('0x4567', 64),
        padToLength('0x890a', 64),
        padToLength('0x4567', 64),
        padToLength('0x890a', 64),
        padToLength('0xabcd', 64),
      ]
      const localBatch = await appendAndGenerateStateBatch(batch)
      const elementIndex = 1
      const element = batch[elementIndex]
      const position = localBatch.getPosition(elementIndex)
      const elementInclusionProof = await localBatch.getElementInclusionProof(
        elementIndex
      )
      //Give wrong position so inclusion proof is wrong
      const wrongPosition = position + 1
      const isIncluded = await stateChain.verifyElement(
        element,
        wrongPosition,
        elementInclusionProof
      )
      isIncluded.should.equal(false)
    })

    it('should return false for wrong position and matching indexInBatch', async () => {
      const batch = [
        padToLength('0x1234', 64),
        padToLength('0x4567', 64),
        padToLength('0x890a', 64),
        padToLength('0x4567', 64),
        padToLength('0x890a', 64),
        padToLength('0xabcd', 64),
      ]
      const localBatch = await appendAndGenerateStateBatch(batch)
      const elementIndex = 1
      const element = batch[elementIndex]
      const position = localBatch.getPosition(elementIndex)
      const elementInclusionProof = await localBatch.getElementInclusionProof(
        elementIndex
      )
      //Give wrong position so inclusion proof is wrong
      const wrongPosition = position + 1
      //Change index to also be false (so position = index + cumulative)
      elementInclusionProof.indexInBatch++
      const isIncluded = await stateChain.verifyElement(
        element,
        wrongPosition,
        elementInclusionProof
      )
      isIncluded.should.equal(false)
    })
  })

  describe('deleteAfterInclusive() ', async () => {
    it('should not allow deletion from address other than fraud verifier', async () => {
      const cumulativePrevElements = 0
      const batchIndex = 0
      const localBatch = await appendAndGenerateStateBatch(DEFAULT_STATE_BATCH)
      const batchHeader = {
        elementsMerkleRoot: await localBatch.elementsMerkleTree.getRootHash(),
        numElementsInBatch: DEFAULT_STATE_BATCH.length,
        cumulativePrevElements,
      }
      await TestUtils.assertRevertsAsync(async () => {
        await stateChain.connect(randomWallet).deleteAfterInclusive(
          batchIndex, // delete the single appended batch
          batchHeader
        )
      }, 'Only FraudVerifier has permission to delete state batches')
    })
    describe('when a single batch is deleted', async () => {
      beforeEach(async () => {
        const cumulativePrevElements = 0
        const batchIndex = 0
        const localBatch = await appendAndGenerateStateBatch(
          DEFAULT_STATE_BATCH
        )
        const batchHeader = {
          elementsMerkleRoot: await localBatch.elementsMerkleTree.getRootHash(),
          numElementsInBatch: DEFAULT_STATE_BATCH.length,
          cumulativePrevElements,
        }
        await stateChain.connect(fraudVerifier).deleteAfterInclusive(
          batchIndex, // delete the single appended batch
          batchHeader
        )
      })

      it('should successfully update the batches array', async () => {
        const batchesLength = await stateChain.getBatchesLength()
        batchesLength.should.equal(0)
      })

      it('should successfully append a batch after deletion', async () => {
        const localBatch = await appendAndGenerateStateBatch(
          DEFAULT_STATE_BATCH
        )
        const expectedBatchHeaderHash = await localBatch.hashBatchHeader()
        const calculatedBatchHeaderHash = await stateChain.batches(0)
        calculatedBatchHeaderHash.should.equal(expectedBatchHeaderHash)
      })
    })

    it('should delete many batches', async () => {
      const deleteBatchIndex = 0
      const localBatches = []
      for (let batchIndex = 0; batchIndex < 5; batchIndex++) {
        const cumulativePrevElements = batchIndex * DEFAULT_STATE_BATCH.length
        const localBatch = await appendAndGenerateStateBatch(
          DEFAULT_STATE_BATCH,
          batchIndex,
          cumulativePrevElements
        )
        localBatches.push(localBatch)
      }
      const deleteBatch = localBatches[deleteBatchIndex]
      const batchHeader = {
        elementsMerkleRoot: deleteBatch.elementsMerkleTree.getRootHash(),
        numElementsInBatch: DEFAULT_STATE_BATCH.length,
        cumulativePrevElements: deleteBatch.cumulativePrevElements,
      }
      await stateChain.connect(fraudVerifier).deleteAfterInclusive(
        deleteBatchIndex, // delete all batches (including and after batch 0)
        batchHeader
      )
      const batchesLength = await stateChain.getBatchesLength()
      batchesLength.should.equal(0)
    })

    it('should revert if batchHeader is incorrect', async () => {
      const cumulativePrevElements = 0
      const batchIndex = 0
      const localBatch = await appendAndGenerateStateBatch(DEFAULT_STATE_BATCH)
      const batchHeader = {
        elementsMerkleRoot: await localBatch.elementsMerkleTree.getRootHash(),
        numElementsInBatch: DEFAULT_STATE_BATCH.length + 1, // increment to make header incorrect
        cumulativePrevElements,
      }
      await TestUtils.assertRevertsAsync(async () => {
        await stateChain.connect(fraudVerifier).deleteAfterInclusive(
          batchIndex, // delete the single appended batch
          batchHeader
        )
      }, 'Calculated batch header is different than expected batch header')
    })

    it('should revert if trying to delete a batch outside of valid range', async () => {
      const cumulativePrevElements = 0
      const batchIndex = 1 // outside of range
      const localBatch = await appendAndGenerateStateBatch(DEFAULT_STATE_BATCH)
      const batchHeader = {
        elementsMerkleRoot: await localBatch.elementsMerkleTree.getRootHash(),
        numElementsInBatch: DEFAULT_STATE_BATCH.length + 1, // increment to make header incorrect
        cumulativePrevElements,
      }
      await TestUtils.assertRevertsAsync(async () => {
        await stateChain
          .connect(fraudVerifier)
          .deleteAfterInclusive(batchIndex, batchHeader)
      }, 'Cannot delete batches outside of valid range')
    })
  })

  describe('Event Emitting', () => {
    it('should emit StateBatchAppended when state batch is appended', async () => {
      let receivedBatchHeaderHash: string
      stateChain.on(stateChain.filters['StateBatchAppended'](), (...data) => {
        receivedBatchHeaderHash = data[0]
      })
      const localBatch = await appendAndGenerateStateBatch(DEFAULT_STATE_BATCH)

      await sleep(5_000)

      const batchReceived: boolean = !!receivedBatchHeaderHash
      batchReceived.should.equal(
        true,
        `State Batch Appended event not received!`
      )
      receivedBatchHeaderHash.should.equal(
        await localBatch.hashBatchHeader(),
        `State Batch Appended event has incorrect batch header hash!`
      )
    })
  })
})
