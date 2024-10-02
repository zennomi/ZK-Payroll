import {
  AccountUpdate,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  MerkleMap,
  MerkleMapWitness,
  Cache,
  UInt64,
  Provable,
  Account,
} from 'o1js';
import { PrivateSalary } from '../contracts/PrivateSalary';

let proofsEnabled = false;
const ONE_MINA = 1_000_000_000;

describe('Test all', () => {
  const cache = Cache.FileSystem('./caches');

  let deployerAccount: Mina.TestPublicKey,
    deployerKey: PrivateKey,
    employeeAccounts: Mina.TestPublicKey[],
    anonymousAccounts: Mina.TestPublicKey[],
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey,
    zkApp: PrivateSalary;

  let salaryTree = new MerkleMap();
  let claimedTree = new MerkleMap();
  let indexes: Field[] = [];
  let indexes_2: Field[] = [];

  const salaries = [1 * ONE_MINA, 2 * ONE_MINA, 3 * ONE_MINA];
  const salaries_2 = [4 * ONE_MINA, 5 * ONE_MINA, 6 * ONE_MINA];

  beforeAll(async () => {
    employeeAccounts = [];
    anonymousAccounts = [];

    if (proofsEnabled) await PrivateSalary.compile({ cache });
    const Local = await Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);

    deployerAccount = Local.testAccounts[0];

    employeeAccounts.push(Local.testAccounts[1]);
    employeeAccounts.push(Local.testAccounts[2]);
    employeeAccounts.push(Local.testAccounts[3]);

    anonymousAccounts.push(Local.testAccounts[4]);
    anonymousAccounts.push(Local.testAccounts[5]);
    anonymousAccounts.push(Local.testAccounts[6]);

    deployerKey = deployerAccount.key;

    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    zkApp = new PrivateSalary(zkAppAddress);

    await localDeploy();
  });

  async function localDeploy() {
    const txn = await Mina.transaction(deployerAccount, async () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      await zkApp.deploy();
    });
    await txn.prove();
    await txn.sign([deployerKey, zkAppPrivateKey]).send();
  }

  it('Distribute salary 1st time', async () => {
    let totalAmount = new UInt64(0);
    for (let i = 0; i < employeeAccounts.length; i++) {
      indexes.push(zkApp.getIndex(employeeAccounts[i], Field(1)));
      salaryTree.set(
        indexes[i],
        Field.fromFields(new UInt64(salaries[i]).toFields())
      );
      totalAmount = totalAmount.add(new UInt64(salaries[i]));
      // Provable.log('Salaries: ', new UInt64(salaries[i]));
      // Provable.log('Total amount inside: ', totalAmount);
    }

    // Provable.log('Total amount: ', totalAmount);
    const txn = await Mina.transaction(deployerAccount, async () => {
      await zkApp.distributeSalary(salaryTree.getRoot(), totalAmount);
    });
    await txn.prove();
    await txn.sign([deployerAccount.key]).send();

    const salaryRootOnchain = zkApp.salaryRoot.get();
    const distributeTime = zkApp.lastDistributeTime.get();
    expect(salaryRootOnchain).toEqual(salaryTree.getRoot());
    expect(distributeTime).toEqual(Field(1));

    const balanceInContract = zkApp.account.balance.get();
    expect(balanceInContract).toEqual(totalAmount);
  });

  it('Claim revenue: employee[0] claim salary using anonymousAccount[0]', async () => {
    const balanceBefore = Mina.getBalance(anonymousAccounts[0]);
    const txn = await Mina.transaction(anonymousAccounts[0], async () => {
      await zkApp.claimSalary(
        employeeAccounts[0].key,
        new UInt64(salaries[0]),
        Field(1),
        salaryTree.getWitness(indexes[0]),
        claimedTree.getWitness(indexes[0])
      );
    });
    await txn.prove();
    await txn.sign([anonymousAccounts[0].key]).send();
    const balanceAfter = Mina.getBalance(anonymousAccounts[0]);
    expect(balanceAfter.sub(balanceBefore)).toEqual(new UInt64(salaries[0]));

    // update storage:
    claimedTree.set(indexes[0], Field(1));
  });

  xit('[Expect fail] Claim again: expect fail with claimed error', async () => {
    const txn = await Mina.transaction(anonymousAccounts[0], async () => {
      await zkApp.claimSalary(
        employeeAccounts[0].key,
        new UInt64(salaries[0]),
        Field(1),
        salaryTree.getWitness(indexes[0]),
        claimedTree.getWitness(indexes[0])
      );
    });
    await txn.prove();
    await txn.sign([anonymousAccounts[0].key]).send();
  });

  it('Claim revenue: employee[1] claim salary using anonymousAccount[1]', async () => {
    const txn = await Mina.transaction(anonymousAccounts[1], async () => {
      await zkApp.claimSalary(
        employeeAccounts[1].key,
        new UInt64(salaries[1]),
        Field(1),
        salaryTree.getWitness(indexes[1]),
        claimedTree.getWitness(indexes[1])
      );
    });
    await txn.prove();
    await txn.sign([anonymousAccounts[1].key]).send();

    // update storage:
    claimedTree.set(indexes[1], Field(1));
  });

  it('Distribute salary 2nd time', async () => {
    let totalAmount = new UInt64(0);
    for (let i = 0; i < employeeAccounts.length; i++) {
      indexes_2.push(zkApp.getIndex(employeeAccounts[i], Field(2)));
      salaryTree.set(
        indexes_2[i],
        Field.fromFields(new UInt64(salaries_2[i]).toFields())
      );
      totalAmount = totalAmount.add(new UInt64(salaries_2[i]));
    }

    const txn = await Mina.transaction(deployerAccount, async () => {
      await zkApp.distributeSalary(salaryTree.getRoot(), totalAmount);
    });
    await txn.prove();
    await txn.sign([deployerAccount.key]).send();

    const salaryRootOnchain = zkApp.salaryRoot.get();
    const distributeTime = zkApp.lastDistributeTime.get();
    expect(salaryRootOnchain).toEqual(salaryTree.getRoot());
    expect(distributeTime).toEqual(Field(2));
  });

  it('Claim revenue 2nd time: employee[0] claim salary using anonymousAccount[0]', async () => {
    const balanceBefore = Mina.getBalance(anonymousAccounts[0]);
    const txn = await Mina.transaction(anonymousAccounts[0], async () => {
      await zkApp.claimSalary(
        employeeAccounts[0].key,
        new UInt64(salaries_2[0]),
        Field(2),
        salaryTree.getWitness(indexes_2[0]),
        claimedTree.getWitness(indexes_2[0])
      );
    });
    await txn.prove();
    await txn.sign([anonymousAccounts[0].key]).send();
    const balanceAfter = Mina.getBalance(anonymousAccounts[0]);
    expect(balanceAfter.sub(balanceBefore)).toEqual(new UInt64(salaries_2[0]));

    // update storage:
    claimedTree.set(indexes_2[0], Field(1));
  });
});
