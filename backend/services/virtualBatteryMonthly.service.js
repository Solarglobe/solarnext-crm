import {getCalendar,bindCalendar,billingPeriods} from './energyCalendar.service.js';
import {buildHpHcHourlyFractions} from './pv/hphcMask.service.js';
const sum=xs=>xs.reduce((a,b)=>a+b,0);
/** Commercial ledger; its allocations do not change the physical grid imports.
 * Credits earned within each billing month are settled against that month's
 * imports, HC first. Hourly allocations are audit allocations, not physical flows. */
export function simulateMonthlyVirtualCredit({pv_hourly,conso_hourly,config,rules}) {
  const n=pv_hourly.length,calendar=getCalendar(conso_hourly,config.calendar);
  const direct=pv_hourly.map((p,i)=>Math.min(p,conso_hourly[i]));
  const surplus=pv_hourly.map((p,i)=>p-direct[i]),physicalImport=conso_hourly.map((v,i)=>v-direct[i]);
  const hp=buildHpHcHourlyFractions(config.off_peak_periods??config.offPeakPeriods,calendar);
  const charge=Array(n).fill(0),used=Array(n).fill(0),usedHp=Array(n).fill(0),usedHc=Array(n).fill(0),overflow=Array(n).fill(0),bankHourly=Array(n).fill(0);
  const opening=Number(config.initial_credit_kwh??config.initialCreditKwh??0);
  if(!Number.isFinite(opening)||opening<0)return {ok:false,reason:'INVALID_INITIAL_CREDIT'};
  const cap=rules.capacity_kwh==null?Infinity:Number(rules.capacity_kwh);
  if(!(cap>0)||opening>cap)return {ok:false,reason:'INVALID_VIRTUAL_CAPACITY'};
  const ratio=Number(rules.credit_ratio??1);
  if(!(ratio>0&&ratio<=1))return {ok:false,reason:'INVALID_CREDIT_RATIO'};
  if(rules.credit_validity_months!=null&&(!Number.isInteger(Number(rules.credit_validity_months))||Number(rules.credit_validity_months)<1))return {ok:false,reason:'INVALID_CREDIT_VALIDITY'};
  const periods=billingPeriods(conso_hourly,calendar);
  const monthOffset=Number(config.credit_month_offset??0);
  const monthNumber=period=>Number(period.key.slice(0,4))*12+period.month+monthOffset;
  let bank=opening,expired=0;const monthly=[];
  const suppliedLots=config.initial_credit_lots;
  const lots=Array.isArray(suppliedLots)?suppliedLots.map(l=>({month:Number(l.month),kwh:Number(l.kwh)})):(opening?[{month:monthNumber(periods[0]),kwh:opening}]:[]);
  if(lots.some(l=>!Number.isInteger(l.month)||!Number.isFinite(l.kwh)||l.kwh<0)||Math.abs(sum(lots.map(l=>l.kwh))-opening)>1e-7)return {ok:false,reason:'INVALID_INITIAL_CREDIT_LOTS'};
  lots.sort((a,b)=>a.month-b.month);
  for(const period of periods) {
    const m=monthNumber(period),start=bank;
    let expiredMonth=0;
    if(rules.credit_validity_months!=null) {
      while(lots.length&&m-lots[0].month>=rules.credit_validity_months){expiredMonth+=lots.shift().kwh;}
      bank-=expiredMonth;expired+=expiredMonth;
    }
    const raw=sum(period.indices.map(i=>surplus[i]));
    const eligible=raw*ratio,credited=Math.min(eligible,Math.max(0,cap-bank));
    if(credited>0)lots.push({month:m,kwh:credited});bank+=credited;
    for(const i of period.indices){charge[i]=raw>0?surplus[i]*credited/raw:0;overflow[i]=surplus[i]-charge[i];}
    for(const slot of rules.priority==='HC_FIRST'?['HC','HP']:['HP','HC']) {
      for(const i of period.indices) {
        const available=physicalImport[i]*(slot==='HP'?hp[i]:1-hp[i]);
        const amount=Math.min(available,bank);
        if(amount<=0)continue;
        used[i]+=amount;(slot==='HP'?usedHp:usedHc)[i]+=amount;bank-=amount;
        let remaining=amount;
        while(remaining>1e-10&&lots.length){const take=Math.min(remaining,lots[0].kwh);lots[0].kwh-=take;remaining-=take;if(lots[0].kwh<1e-10)lots.shift();}
      }
    }
    for(const i of period.indices)bankHourly[i]=bank;
    monthly.push({period:period.key,month:period.month,opening_kwh:start,credited_kwh:credited,used_credit_kwh:sum(period.indices.map(i=>used[i])),used_hp_kwh:sum(period.indices.map(i=>usedHp[i])),used_hc_kwh:sum(period.indices.map(i=>usedHc[i])),expired_kwh:expiredMonth,cashout_kwh:0,cashout_eur:0,closing_kwh:bank});
  }
  let cashout=0,cashoutKwh=0;
  if(config.anniversary_cashout_requested===true) {
    const rate=Number(config.anniversary_base_energy_price_eur_kwh);
    if(!Number.isFinite(rate)||rate<0)return {ok:false,reason:'ANNIVERSARY_ENERGY_PRICE_REQUIRED'};
    cashoutKwh=bank;cashout=bank*rate/4;bank=0;lots.length=0;
    if(monthly.length)Object.assign(monthly.at(-1),{cashout_kwh:cashoutKwh,cashout_eur:cashout,closing_kwh:0});
  } else if(rules.annual_reset===true){
    if(monthly.length){monthly.at(-1).expired_kwh+=bank;monthly.at(-1).closing_kwh=0;}
    expired+=bank;bank=0;lots.length=0;
  }
  if(n)bankHourly[n-1]=bank;
  const imported=physicalImport.map((v,i)=>Math.max(0,v-used[i]));
  const billableHp=sum(physicalImport.map((v,i)=>v*hp[i]-usedHp[i]));
  const billableHc=sum(physicalImport.map((v,i)=>v*(1-hp[i])-usedHc[i]));
  const bind=x=>bindCalendar(x,calendar);
  return {ok:true,calendar,provider_rules:rules,commercial_ledger:{rules,periods:monthly,allocation:'billing_only',opening_kwh:opening,closing_kwh:bank,closing_lots:lots.map(l=>({...l})),credited_kwh:sum(charge),used_hp_kwh:sum(usedHp),used_hc_kwh:sum(usedHc),billable_hp_kwh:billableHp,billable_hc_kwh:billableHc,expired_kwh:expired,cashout_kwh:cashoutKwh,cashout_eur:cashout},
    virtual_battery_capacity_kwh:Number.isFinite(cap)?cap:null,virtual_battery_credit_start_kwh:opening,virtual_battery_credit_end_kwh:bank,
    virtual_battery_total_charged_kwh:sum(charge),virtual_battery_total_discharged_kwh:sum(used),virtual_battery_overflow_export_kwh:sum(overflow),
    virtual_battery_hourly_charge_kwh:bind(charge),virtual_battery_hourly_discharge_kwh:bind(used),virtual_battery_hourly_discharge_hp_kwh:bind(usedHp),virtual_battery_hourly_discharge_hc_kwh:bind(usedHc),virtual_battery_hourly_credit_balance_kwh:bind(bankHourly),virtual_battery_hourly_overflow_export_kwh:bind(overflow),virtual_battery_hourly_grid_import_kwh:bind(imported),
    direct_self_consumption_hourly:bind(direct),surplus_before_virtual_battery_hourly:bind(surplus),physical_grid_import_hourly:bind(physicalImport),
    auto_hourly:bind(direct.map((v,i)=>v+used[i])),surplus_hourly:bind(overflow),batt_discharge_hourly:bind(used),
    prod_kwh:sum(pv_hourly),auto_kwh:sum(direct)+sum(used),direct_self_consumption_kwh:sum(direct),surplus_before_virtual_battery_kwh:sum(surplus),surplus_kwh:sum(overflow),grid_import_kwh:sum(imported),
    _balance:{sum_pv:sum(pv_hourly),sum_load:sum(conso_hourly),sum_import:sum(imported),sum_overflow:sum(overflow),soc_start:opening,soc_end:bank,credit_expired_kwh:expired+cashoutKwh}};
}
