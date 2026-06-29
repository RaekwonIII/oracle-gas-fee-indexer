# oracle-gas-fee-indexer

A subgraph that indexes the **`ClusterBalanceUpdated`** and **`WeightedRootProposed`**
events of the SSVNetwork contract on Ethereum mainnet
([`0xDD9BC35aE942eF0cFa76930954a156B3fF30a4E1`](https://etherscan.io/address/0xDD9BC35aE942eF0cFa76930954a156B3fF30a4E1))
and computes the **gas fee paid for each emitting transaction**, then rolls those
fees up per transaction sender.

## What it indexes

The `ClusterBalanceUpdated` and `WeightedRootProposed` events are handled identically:
each emitting transaction contributes its gas fee to the sender's totals. For
every occurrence the handler reads the **transaction receipt** (enabled via
`receipt: true` in the manifest) and computes:

```
gasFee = receipt.gasUsed * transaction.gasPrice   // in wei
```

> The receipt exposes `gasUsed` but not the effective gas price, so the
> transaction's `gasPrice` (which graph-node populates with the effective price)
> is used.

## Schema

| Entity | Purpose |
| --- | --- |
| `GasFeePayment` | `@entity(timeseries: true)` — one immutable data point per indexed event (sender, gasFee, gasUsed, gasPrice, owner [null for `WeightedRootProposed`], txHash). `id`/`timestamp` are auto-managed by graph-node. |
| `SenderGasFeeStats` | `@aggregation` over `GasFeePayment`, grouped by the `sender` dimension, summing `gasFee` (`@aggregate(fn: "sum")`). |
| `MonthlyGasFeeBySender` | Manual monthly rollup of total gas fees per sender. |

### Note on monthly aggregation

The Graph's native `@aggregation` only supports the **`hour`** and **`day`**
intervals — there is **no native `month` interval**. The `SenderGasFeeStats`
aggregation therefore uses `day` (the coarsest native granularity), and the
**monthly** sum-per-sender requirement is satisfied by `MonthlyGasFeeBySender`,
which the mapping maintains by bucketing events into UTC calendar months.

## Develop

```bash
npm install
npm run codegen   # generate types from schema + ABI
npm run build     # compile to WASM and validate the manifest
```

## Deploy

```bash
graph auth <DEPLOY_KEY>   # from Subgraph Studio
npm run deploy
```

The contract ABI lives in [`abis/SSVNetwork.json`](./abis/SSVNetwork.json).
`startBlock` in `subgraph.yaml`/`networks.json` is set to the SSVNetwork mainnet
deployment block — adjust if you need different coverage.
