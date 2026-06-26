import { BigInt } from '@graphprotocol/graph-ts';
import { ClusterBalanceUpdated } from '../generated/SSVNetwork/SSVNetwork';
import { GasFeePayment, MonthlyGasFeeBySender } from '../generated/schema';

const SECONDS_PER_DAY: i64 = 86400;

// Result of converting a unix timestamp into a UTC calendar month.
class YearMonth {
  year: i32 = 0;
  month: i32 = 0; // 1-12
  monthStart: i64 = 0; // unix seconds at 00:00:00 UTC on the 1st of the month
}

// civil_from_days (Howard Hinnant's algorithm) — derive the UTC calendar date
// from a unix timestamp without relying on a Date type (unavailable in AS).
function toYearMonth(timestampSeconds: i64): YearMonth {
  let days = timestampSeconds / SECONDS_PER_DAY;

  let z = days + 719468;
  let era = (z >= 0 ? z : z - 146096) / 146097;
  let doe = z - era * 146097; // [0, 146096]
  let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
  let y = yoe + era * 400;
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
  let mp = (5 * doy + 2) / 153; // [0, 11]
  let m = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  let year = m <= 2 ? y + 1 : y;

  let result = new YearMonth();
  result.year = i32(year);
  result.month = i32(m);
  result.monthStart = daysFromCivil(year, m, 1) * SECONDS_PER_DAY;
  return result;
}

// days_from_civil — inverse of the above, used to get the month's first instant.
function daysFromCivil(y: i64, m: i64, d: i64): i64 {
  let yy = m <= 2 ? y - 1 : y;
  let era = (yy >= 0 ? yy : yy - 399) / 400;
  let yoe = yy - era * 400;
  let doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + (d - 1);
  let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + doe - 719468;
}

export function handleClusterBalanceUpdated(event: ClusterBalanceUpdated): void {
  // The receipt is requested via `receipt: true` in the manifest; guard anyway.
  let receipt = event.receipt;
  if (receipt == null) {
    return;
  }

  // Gas fee paid for the whole transaction, in wei.
  // graph-ts exposes gasUsed on the receipt but not the effective gas price, so
  // we use the transaction's gasPrice (populated with the effective price).
  let gasUsed = receipt.gasUsed;
  let gasPrice = event.transaction.gasPrice;
  let gasFee = gasUsed.times(gasPrice);
  let sender = event.transaction.from;

  // 1. Raw, per-transaction data point. `id` and `timestamp` are assigned
  //    automatically by graph-node for timeseries entities.
  let payment = new GasFeePayment(0);
  payment.sender = sender;
  payment.gasFee = gasFee;
  payment.gasUsed = gasUsed;
  payment.gasPrice = gasPrice;
  payment.owner = event.params.owner;
  payment.txHash = event.transaction.hash;
  payment.save();

  // 2. Manual monthly rollup per sender, keyed by <sender>-<YYYYMM>. This covers
  //    the monthly requirement, which the native @aggregation cannot express
  //    (only "hour"/"day" intervals are supported).
  let ym = toYearMonth(event.block.timestamp.toI64());
  let monthKey = ym.year * 100 + ym.month;
  let id = sender.toHexString() + '-' + monthKey.toString();

  let monthly = MonthlyGasFeeBySender.load(id);
  if (monthly == null) {
    monthly = new MonthlyGasFeeBySender(id);
    monthly.sender = sender;
    monthly.monthStart = BigInt.fromI64(ym.monthStart);
    monthly.year = ym.year;
    monthly.month = ym.month;
    monthly.totalGasFees = BigInt.zero();
    monthly.txCount = BigInt.zero();
  }
  monthly.totalGasFees = monthly.totalGasFees.plus(gasFee);
  monthly.txCount = monthly.txCount.plus(BigInt.fromI32(1));
  monthly.save();
}
