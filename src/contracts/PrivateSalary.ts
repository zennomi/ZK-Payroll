import {
  Field,
  SmartContract,
  state,
  State,
  method,
  MerkleMap,
  MerkleMapWitness,
  PrivateKey,
  PublicKey,
  Poseidon,
  AccountUpdate,
  UInt64,
} from 'o1js';

// Level 2 tree is a merkle map
const EMPTY_TREE = new MerkleMap();

export class PrivateSalary extends SmartContract {
  @state(Field) salaryRoot = State<Field>(); // value in the tree is salary
  @state(Field) claimedRoot = State<Field>(); // value in the tree is true/false = Field(1)/Field(0)
  @state(Field) lastDistributeTime = State<Field>();

  init() {
    super.init();
    this.salaryRoot.set(EMPTY_TREE.getRoot());
    this.claimedRoot.set(EMPTY_TREE.getRoot());
    this.lastDistributeTime.set(Field(0));
  }

  // update salary root
  @method async distributeSalary(newTreeRoot: Field, totalSalary: UInt64) {
    let currentDistributeTime = this.lastDistributeTime.getAndRequireEquals();
    currentDistributeTime = currentDistributeTime.add(Field(1));
    this.lastDistributeTime.set(currentDistributeTime);

    // update salary root
    this.salaryRoot.set(newTreeRoot);

    // transfer money to the sender
    const company = AccountUpdate.createSigned(
      this.sender.getAndRequireSignatureV2()
    );
    company.send({
      to: this.address,
      amount: totalSalary,
    });
  }

  @method async claimSalary(
    privateKey: PrivateKey,
    salaryAmount: UInt64,
    distributeTime: Field,
    salaryWitness: MerkleMapWitness,
    claimedWitness: MerkleMapWitness
  ) {
    let employeePubKey = privateKey.toPublicKey();
    let lastDistributeTime = this.lastDistributeTime.getAndRequireEquals();

    lastDistributeTime.assertGreaterThanOrEqual(
      distributeTime,
      'Invalid distribute time'
    );

    let calculatedIndex = this.getIndex(employeePubKey, distributeTime);
    let [salaryRoot, salaryIndex] = salaryWitness.computeRootAndKeyV2(
      Field.fromFields(salaryAmount.toFields())
    );
    let [claimedRoot, claimedIndex] = claimedWitness.computeRootAndKeyV2(
      Field(0) // meaning not claimed
    );

    calculatedIndex.assertEquals(salaryIndex, 'Invalid salary index');
    calculatedIndex.assertEquals(claimedIndex, 'Invalid claimed index');

    salaryRoot.assertEquals(
      this.salaryRoot.getAndRequireEquals(),
      'Invalid salary root'
    );
    claimedRoot.assertEquals(
      this.claimedRoot.getAndRequireEquals(),
      'Invalid claimed root'
    );

    // update claimed index
    let [newClaimedRoot, _] = claimedWitness.computeRootAndKeyV2(
      Field(1) // meaning claimed
    );
    this.claimedRoot.set(newClaimedRoot);

    this.send({
      to: AccountUpdate.create(this.sender.getAndRequireSignatureV2()),
      amount: salaryAmount,
    });
  }

  getIndex(pubKey: PublicKey, distributeTime: Field): Field {
    return Poseidon.hash([pubKey.toFields(), distributeTime].flat());
  }
}
