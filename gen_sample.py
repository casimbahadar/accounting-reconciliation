# Demo 2 sample: invoices + bank CSV with planted problems. Expected results are
# written from the plan here, never computed by the tool.
import csv, io, json, random
from datetime import date, timedelta
R = random.Random(21)
people = ["Priya Raman","Omar Haddad","Grace Liu","Liam Fraser","Sofia Rossi","Yusuf Khan","Nadia Petrova","Owen Clarke",
 "Mei Tanaka","Ravi Kapoor","Tessa Kaur","Diego Morales","Fiona Walsh","Adam Kowal","Sara Lindberg","Kofi Asante",
 "Emily Harper","Hana Sato","Zoe Laurent","Caleb Hughes","Leila Nasser","Victor Lindqvist","Julia Novak","Isaac Mensah",
 "Aisha Bello","Ben Hofstetter","Chloe Dubois","Mateo Alvarez","Amara Okeke","Noah Martin","Ines Carvalho","Wei Zhang",
 "Rachel Bauer","Ethan Brooks","Marcus Reid","Lucas DeSouza","Anna Kowalski","Farah Siddiqui","Jon Tremblay","Maya Patel"]
def cents(x): return int(round(x*100))
def hst(sub): return (sub*13 + 50)//100          # 13% rounded half up, in cents
def money(c): return f"{c//100}.{c%100:02d}"
def money_fmt(c): return f"{c//100:,}.{c%100:02d}"

inv = []
d0 = date(2026,6,1)
used_totals=set()
for i in range(40):
    sub = cents(R.choice([150,225,300,360,480,525,640,750,880,960,1150,1275,1480,1650,2200,2475,3100]) + R.choice([0,0,0.5,0.75,0.25]))
    while True:
        tax=hst(sub); tot=sub+tax
        if tot not in used_totals: break
        sub += 137
    used_totals.add(tot)
    inv.append({"num":f"INV-{1001+i}","cust":people[i],"date":d0+timedelta(days=i*2+R.randint(0,1)),"sub":sub,"code":"H13","tax":tax})
I={x["num"]:x for x in inv}
# roles (index into inv)
roles = {}
ref_single = list(range(0,28)); amount_only=[28,29,30,31]; split=[32]; partial=[33,34]; unpaid=[35,36,37]; dup=[38,39]
# traps and HST problems inside the reference-paid group
same_a, same_b = 4, 5                           # same total, told apart by reference
I["INV-1006"]["sub"] = I["INV-1005"]["sub"]; I["INV-1006"]["tax"]=I["INV-1005"]["tax"]
late = 10                                       # paid by reference 70 days later
wrong_hst = {12: 12, 20: 5}                     # charged 12% and 5%
for k,rate in wrong_hst.items(): inv[k]["tax"] = (inv[k]["sub"]*rate+50)//100
rounding = 15; inv[rounding]["sub"]=43785; inv[rounding]["tax"]=hst(43785)+1   # one cent over, allowed
inv[7]["code"]="EXEMPT"; inv[7]["tax"]=0
inv[9]["code"]="ZERO"; inv[9]["tax"]=0
inv[18]["code"]="ZERO"                          # charges 13% under a no-tax code
for x in inv: x["total"]=x["sub"]+x["tax"]
inv[22]["total"]+=1000                          # total is $10.00 more than subtotal plus tax
assert I["INV-1005"]["total"]==I["INV-1006"]["total"]

bank=[]   # dict(date, desc, amount cents signed, label)
def pay(k, delta, desc, amt=None, label=None):
    x=inv[k]; bank.append({"date":x["date"]+timedelta(days=delta),"desc":desc,"amt":x["total"] if amt is None else amt,"label":label or ("pay",x["num"])})
fmts=["E-TRANSFER RECEIVED {C} {N}","ONLINE BANKING PAYMENT {n}","DEPOSIT #{d}","CHEQUE DEPOSIT REF INVOICE {d}","EFT CREDIT {L} {F0} - {N}"]
def refdesc(k):
    x=inv[k]; f,l=x["cust"].upper().split(" ",1)
    return R.choice(fmts).format(C=x["cust"].upper(),N=x["num"],n=x["num"].replace("-",""),d=x["num"][4:],L=l,F0=f[0])
for k in ref_single:
    pay(k, 70 if k==late else R.randint(3,30), refdesc(k))
amt_descs=["E-TRANSFER RECEIVED {C}","MOBILE CHEQUE DEPOSIT","BRANCH DEPOSIT","E-TRANSFER RECEIVED {C}"]
for j,k in enumerate(amount_only):
    pay(k, R.randint(4,25), amt_descs[j].format(C=inv[k]["cust"].upper()), label=("amount",inv[k]["num"]))
x=inv[split[0]]; h1=x["total"]//2
pay(split[0], 5, refdesc(split[0]), h1, ("split",x["num"])); pay(split[0], 35, refdesc(split[0]), x["total"]-h1, ("split",x["num"]))
for k in partial:
    pay(k, 12, refdesc(k), inv[k]["total"]-R.choice([10000,25000]), ("partial",inv[k]["num"]))
for k in dup:
    d=refdesc(k); pay(k, 8, d, label=("pay",inv[k]["num"])); pay(k, 9, d, label=("dup",inv[k]["num"]))
bank.append({"date":date(2026,7,22),"desc":"BRANCH DEPOSIT","amt":81240,"label":("unmatched","no reference")})
bank.append({"date":date(2026,8,14),"desc":"E-TRANSFER RECEIVED K ABARA","amt":30000,"label":("unmatched","no reference")})
bank.append({"date":date(2026,9,3),"desc":"ONLINE BANKING PAYMENT INV-2099","amt":45200,"label":("unmatched","unknown invoice")})
for dd,desc,a in [(date(2026,7,2),"MONTHLY ACCOUNT FEE",-1695),(date(2026,7,1),"RENT PAYMENT",-185000),(date(2026,8,5),"SOFTWARE SUBSCRIPTION",-5650),
                  (date(2026,8,20),"INSURANCE PREMIUM",-21340),(date(2026,9,15),"ACCOUNTANT FEE",-33900)]:
    bank.append({"date":dd,"desc":desc,"amt":a,"label":("withdrawal","")})
bank.sort(key=lambda b:(b["date"],b["desc"]))
assert len(bank)==48

# guard: amount-only payments must match exactly one open invoice in window; unmatched ones none
def open_at(k): return True
# write files
b=io.StringIO(); w=csv.writer(b,lineterminator="\n"); w.writerow(["Invoice number","Customer","Invoice date","Subtotal","Tax code","Tax","Total"])
for x in inv: w.writerow([x["num"],x["cust"],x["date"].isoformat(),money(x["sub"]),x["code"],money(x["tax"]),money_fmt(x["total"])])
open("invoices.csv","w").write(b.getvalue())
b=io.StringIO(); w=csv.writer(b,lineterminator="\n"); w.writerow(["Date","Description","Withdrawal","Deposit"])
for r in bank:
    dt=f'{r["date"].month}/{r["date"].day}/{r["date"].year}'
    w.writerow([dt,r["desc"], money(-r["amt"]) if r["amt"]<0 else "", money(r["amt"]) if r["amt"]>0 else ""])
open("bank.csv","w").write(b.getvalue())

row={i:i+2 for i in range(len(bank))}
matched=[]; exc=[]
for i,r in enumerate(bank):
    t,n=r["label"]
    if t=="pay": matched.append([row[i],n,"reference"])
    elif t=="amount": matched.append([row[i],n,"amount"])
    elif t=="split": matched.append([row[i],n,"reference"])
    elif t=="partial": matched.append([row[i],n,"reference"])
    elif t=="dup": exc.append(["duplicate",n,row[i]])
    elif t=="unmatched": exc.append(["unmatched","",row[i]])
for k in partial: exc.append(["partial",inv[k]["num"],None])
for k in unpaid: exc.append(["unpaid",inv[k]["num"],None])
for k in wrong_hst: exc.append(["hst",inv[k]["num"],None])
exc.append(["taxonexempt",inv[18]["num"],None])
exc.append(["totalmismatch",inv[22]["num"],None])
exp={"matched":sorted(matched),"exceptions":sorted(exc,key=lambda e:(e[0],e[1],e[2] or 0)),
     "counts":{"deposits":43,"withdrawals":5,"matched_payments":len(matched),"exceptions":len(exc)},
     "traps":{"same_amount":["INV-1005","INV-1006"],"late":inv[late]["num"],"rounding":inv[rounding]["num"],"exempt":inv[7]["num"],"zero":inv[9]["num"],"split":inv[split[0]]["num"]},
     "status":{**{inv[k]["num"]:"partial" for k in partial},**{inv[k]["num"]:"unpaid" for k in unpaid},inv[split[0]]["num"]:"paid2"}}
json.dump(exp,open("expected.json","w"),indent=1)
from collections import Counter
print(exp["counts"], Counter(e[0] for e in exc))

# ---- independent sanity checks on the plan (Python model, not the tool)
openinv = [inv[k] for k in amount_only+unpaid]
bal = {x["num"]:x["total"] for x in openinv}
for k in partial:
    paid=[r["amt"] for r in bank if r["label"]==("partial",inv[k]["num"])][0]; bal[inv[k]["num"]]=inv[k]["total"]-paid
def cands(r, window=45):
    return [n for n,b in bal.items() if b==r["amt"] and I[n]["date"]<=r["date"]<=I[n]["date"]+timedelta(days=window)]
for r in bank:
    t,n=r["label"]
    if t=="amount": assert cands(r)==[n], (n, cands(r))
    if t=="unmatched" and n=="no reference": assert cands(r)==[], cands(r)
# unpaid invoices must not be matchable by any unreferenced deposit
for k in unpaid:
    assert not any(r["amt"]==inv[k]["total"] for r in bank if r["label"][0] in ("amount","unmatched") ), inv[k]["num"]
print("plan checks ok; HST wrong:", [inv[k]["num"] for k in wrong_hst], "rounding:", inv[rounding]["num"], "late:", inv[late]["num"])
