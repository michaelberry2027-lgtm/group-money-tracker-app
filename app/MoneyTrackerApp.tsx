
"use client";

import React, { useEffect, useState } from "react";
import { db } from "../lib/firebaseClient";
import { doc, getDoc, setDoc } from "firebase/firestore";

type Person = {
  id: string;
  name: string;
};

type Item = {
  id: string;
  description: string;
  priceCents: number;
  participantIds: string[];
};

type PurchaseStatus = "open" | "settled";

type Purchase = {
  id: string;
  title: string;
  date: string;
  items: Item[];
  taxAndFeesCents: number;
  receiptDataUrl?: string;
  notes?: string;
  status: PurchaseStatus;
};

type Payment = {
  id: string;
  personId: string;
  amountCents: number;
  date: string;
  note?: string;
  method?: string;
};

type AppState = {
  people: Person[];
  purchases: Purchase[];
  payments: Payment[];
};

type MoneyTrackerAppProps = {
  userId: string;
};

const EMPTY_STATE: AppState = {
  people: [],
  purchases: [],
  payments: [],
};

const STORAGE_DOC_ID = "state";

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function parseMoneyToCents(value: string): number {
  const n = parseFloat(value.replace(/[^0-9.]/g, ""));
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as any).randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// --- helpers to compute who owes what ---

function getPurchaseBreakdown(
  purchase: Purchase
): Record<string, number> {
  const result: Record<string, number> = {};

  const participantsSet = new Set<string>();
  purchase.items.forEach((item) => {
    item.participantIds.forEach((pid) => participantsSet.add(pid));
  });

  const participants = Array.from(participantsSet);

  participants.forEach((pid) => {
    result[pid] = 0;
  });

  // split items
  purchase.items.forEach((item) => {
    if (item.participantIds.length === 0) return;
    const perPerson = Math.round(
      item.priceCents / item.participantIds.length
    );
    item.participantIds.forEach((pid) => {
      result[pid] = (result[pid] || 0) + perPerson;
    });
  });

  // split tax & fees
  if (participants.length > 0 && purchase.taxAndFeesCents > 0) {
    const baseFee = Math.floor(
      purchase.taxAndFeesCents / participants.length
    );
    let remainder =
      purchase.taxAndFeesCents - baseFee * participants.length;

    participants.forEach((pid) => {
      let extra = 0;
      if (remainder > 0) {
        extra = 1;
        remainder -= 1;
      }
      result[pid] = (result[pid] || 0) + baseFee + extra;
    });
  }

  return result;
}

function getTotalOwedByPerson(
  purchases: Purchase[]
): Record<string, number> {
  const totals: Record<string, number> = {};
  purchases.forEach((purchase) => {
    const breakdown = getPurchaseBreakdown(purchase);
    Object.entries(breakdown).forEach(([pid, amount]) => {
      totals[pid] = (totals[pid] || 0) + amount;
    });
  });
  return totals;
}

function getTotalPaidByPerson(
  payments: Payment[]
): Record<string, number> {
  const totals: Record<string, number> = {};
  payments.forEach((payment) => {
    totals[payment.personId] =
      (totals[payment.personId] || 0) + payment.amountCents;
  });
  return totals;
}

// --- person statement modal ---

type PersonStatementModalProps = {
  person: Person;
  purchases: Purchase[];
  payments: Payment[];
  onClose: () => void;
};

const PersonStatementModal: React.FC<PersonStatementModalProps> = ({
  person,
  purchases,
  payments,
  onClose,
}) => {
  const relevantPurchases = purchases.filter((purchase) =>
    purchase.items.some((item) =>
      item.participantIds.includes(person.id)
    )
  );

  const purchaseRows = relevantPurchases.map((purchase) => {
    const breakdown = getPurchaseBreakdown(purchase);
    const amount = breakdown[person.id] || 0;
    return { purchase, amountCents: amount };
  });

  const personPayments = payments.filter(
    (p) => p.personId === person.id
  );

  const totalChargesCents = purchaseRows.reduce(
    (sum, row) => sum + row.amountCents,
    0
  );
  const totalPaymentsCents = personPayments.reduce(
    (sum, p) => sum + p.amountCents,
    0
  );
  const balanceCents = totalChargesCents - totalPaymentsCents;

  const exportCSV = () => {
    const rows: string[][] = [];

    rows.push([
      "Type",
      "Date",
      "Description",
      "Amount",
      "Status / Method",
      "Notes",
    ]);

    purchaseRows.forEach(({ purchase, amountCents }) => {
      rows.push([
        "Charge",
        purchase.date,
        purchase.title,
        (amountCents / 100).toFixed(2),
        purchase.status === "open" ? "Open" : "Settled",
        purchase.notes || "",
      ]);
    });

    personPayments.forEach((p) => {
      rows.push([
        "Payment",
        p.date,
        "Payment",
        (-p.amountCents / 100).toFixed(2),
        p.method || "",
        p.note || "",
      ]);
    });

    rows.push([]);
    rows.push(["Summary", "", "", "", "", ""]);
    rows.push([
      "Total Charges",
      "",
      "",
      (totalChargesCents / 100).toFixed(2),
      "",
      "",
    ]);
    rows.push([
      "Total Payments",
      "",
      "",
      (totalPaymentsCents / 100).toFixed(2),
      "",
      "",
    ]);
    rows.push([
      "Balance",
      "",
      "",
      (balanceCents / 100).toFixed(2),
      "",
      "",
    ]);

    const csvContent = rows
      .map((r) =>
        r
          .map((field) =>
            `"${(field ?? "").replace(/"/g, '""')}"`
          )
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${person.name}-statement.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printStatement = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-lg font-semibold">
              Statement for {person.name}
            </h3>
            <p className="text-xs text-slate-500">
              Charges, fees, and payments across all purchases.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-800 border rounded px-2 py-1"
          >
            Close
          </button>
        </div>

        {/* summary */}
        <div className="grid grid-cols-3 gap-3 text-sm mb-4">
          <div className="border rounded-md p-2">
            <div className="text-xs text-slate-500">
              Total charges
            </div>
            <div className="font-semibold">
              {formatCurrency(totalChargesCents)}
            </div>
          </div>
          <div className="border rounded-md p-2">
            <div className="text-xs text-slate-500">
              Total payments
            </div>
            <div className="font-semibold">
              {formatCurrency(totalPaymentsCents)}
            </div>
          </div>
          <div className="border rounded-md p-2">
            <div className="text-xs text-slate-500">Balance</div>
            <div
              className={
                balanceCents > 0
                  ? "font-semibold text-rose-600"
                  : balanceCents < 0
                  ? "font-semibold text-emerald-600"
                  : "font-semibold"
              }
            >
              {formatCurrency(balanceCents)}
            </div>
          </div>
        </div>

        {/* charges */}
        <div className="mb-4">
          <h4 className="text-sm font-semibold mb-1">
            Charges (purchases they’re in)
          </h4>
          {purchaseRows.length === 0 ? (
            <p className="text-xs text-slate-500">
              This person is not part of any purchases yet.
            </p>
          ) : (
            <div className="border rounded-md text-xs overflow-hidden">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-2 py-1 text-left border-b">
                      Date
                    </th>
                    <th className="px-2 py-1 text-left border-b">
                      Purchase
                    </th>
                    <th className="px-2 py-1 text-right border-b">
                      Amount
                    </th>
                    <th className="px-2 py-1 text-left border-b">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseRows.map(({ purchase, amountCents }) => (
                    <tr key={purchase.id} className="border-b last:border-0">
                      <td className="px-2 py-1">{purchase.date}</td>
                      <td className="px-2 py-1">{purchase.title}</td>
                      <td className="px-2 py-1 text-right">
                        {formatCurrency(amountCents)}
                      </td>
                      <td className="px-2 py-1">
                        {purchase.status === "open" ? "Open" : "Settled"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* payments */}
        <div className="mb-4">
          <h4 className="text-sm font-semibold mb-1">Payments</h4>
          {personPayments.length === 0 ? (
            <p className="text-xs text-slate-500">
              No payments recorded for this person.
            </p>
          ) : (
            <div className="border rounded-md text-xs overflow-hidden">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-2 py-1 text-left border-b">
                      Date
                    </th>
                    <th className="px-2 py-1 text-left border-b">
                      Method
                    </th>
                    <th className="px-2 py-1 text-left border-b">
                      Note
                    </th>
                    <th className="px-2 py-1 text-right border-b">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {personPayments.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="px-2 py-1">{p.date}</td>
                      <td className="px-2 py-1">
                        {p.method || "—"}
                      </td>
                      <td className="px-2 py-1">
                        {p.note || "—"}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {formatCurrency(p.amountCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* footer actions */}
        <div className="flex justify-between gap-2 mt-4">
          <button
            onClick={exportCSV}
            className="inline-flex items-center justify-center rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
          >
            Download CSV
          </button>
          <button
            onClick={printStatement}
            className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            Print / Save as PDF
          </button>
        </div>
      </div>
    </div>
  );
};

// --- main app ---

const MoneyTrackerApp: React.FC<MoneyTrackerAppProps> = ({ userId }) => {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [loadedFromDb, setLoadedFromDb] = useState(false);

  // form state
  const [newPersonName, setNewPersonName] = useState("");

  const [purchaseTitle, setPurchaseTitle] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [taxFeesInput, setTaxFeesInput] = useState("");
  const [purchaseNotes, setPurchaseNotes] = useState("");
  const [receiptFileName, setReceiptFileName] = useState("");
  const [receiptDataUrl, setReceiptDataUrl] = useState<string | undefined>(
    undefined
  );
  const [items, setItems] = useState<Item[]>([]);

  const [paymentPersonId, setPaymentPersonId] = useState("");
  const [paymentAmountInput, setPaymentAmountInput] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");

  const [statementPersonId, setStatementPersonId] = useState<string | null>(
    null
  );

  // load state from Firestore
  useEffect(() => {
    const load = async () => {
      try {
        const ref = doc(db, "users", userId, "app", STORAGE_DOC_ID);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() as AppState;

          const migrated: AppState = {
            people: data.people || [],
            purchases: (data.purchases || []).map((p: any) => ({
              ...p,
              status: p.status ?? "open",
            })),
            payments: data.payments || [],
          };

          setState(migrated);
        } else {
          setState(EMPTY_STATE);
        }
      } catch (e) {
        console.error("Error loading state from Firestore", e);
      } finally {
        setLoadedFromDb(true);
      }
    };
    load();
  }, [userId]);

// save state to Firestore whenever it changes
useEffect(() => {
  if (!loadedFromDb) return;
  const save = async () => {
    try {
      const ref = doc(db, "users", userId, "app", STORAGE_DOC_ID);

      // Firestore does not allow undefined values.
      // This strips out undefined fields from nested objects/arrays.
      const cleanedState = JSON.parse(JSON.stringify(state));

      await setDoc(ref, cleanedState);
    } catch (e) {
      console.error("Error saving state to Firestore", e);
    }
  };
  save();
}, [state, userId, loadedFromDb]);

  // handlers
  const addPerson = () => {
    const name = newPersonName.trim();
    if (!name) return;
    const person: Person = { id: generateId(), name };
    setState((prev) => ({
      ...prev,
      people: [...prev.people, person],
    }));
    setNewPersonName("");
  };

  const addItemRow = () => {
    const newItem: Item = {
      id: generateId(),
      description: "",
      priceCents: 0,
      participantIds: [],
    };
    setItems((prev) => [...prev, newItem]);
  };

  const updateItem = (id: string, patch: Partial<Item>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  };

  const toggleItemParticipant = (itemId: string, personId: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        const has = item.participantIds.includes(personId);
        return {
          ...item,
          participantIds: has
            ? item.participantIds.filter((id) => id !== personId)
            : [...item.participantIds, personId],
        };
      })
    );
  };

  const removeItem = (itemId: string) => {
    setItems((prev) => prev.filter((item) => item.id !== itemId));
  };

  const handleReceiptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setReceiptFileName("");
      setReceiptDataUrl(undefined);
      return;
    }
    setReceiptFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        setReceiptDataUrl(result);
      }
    };
    reader.readAsDataURL(file);
  };

  const savePurchase = () => {
    if (!purchaseTitle.trim()) {
      alert("Please enter a purchase title.");
      return;
    }
    if (items.length === 0) {
      alert("Please add at least one item.");
      return;
    }

    const cleanedItems = items.map((item) => ({
      ...item,
      description: item.description.trim() || "Item",
    }));

    const purchase: Purchase = {
      id: generateId(),
      title: purchaseTitle.trim(),
      date: purchaseDate || new Date().toISOString().slice(0, 10),
      items: cleanedItems,
      taxAndFeesCents: parseMoneyToCents(taxFeesInput),
      receiptDataUrl,
      notes: purchaseNotes.trim() || undefined,
      status: "open",
    };

    setState((prev) => ({
      ...prev,
      purchases: [purchase, ...prev.purchases],
    }));

    setPurchaseTitle("");
    setPurchaseDate("");
    setTaxFeesInput("");
    setPurchaseNotes("");
    setItems([]);
    setReceiptDataUrl(undefined);
    setReceiptFileName("");
  };

  const togglePurchaseStatus = (purchaseId: string) => {
    setState((prev) => ({
      ...prev,
      purchases: prev.purchases.map((p) =>
        p.id === purchaseId
          ? {
              ...p,
              status: p.status === "open" ? "settled" : "open",
            }
          : p
      ),
    }));
  };

  const addPayment = () => {
    if (!paymentPersonId) {
      alert("Select a person for the payment.");
      return;
    }
    const amountCents = parseMoneyToCents(paymentAmountInput);
    if (amountCents <= 0) {
      alert("Enter a valid payment amount.");
      return;
    }

    const payment: Payment = {
      id: generateId(),
      personId: paymentPersonId,
      amountCents,
      date: paymentDate || new Date().toISOString().slice(0, 10),
      note: paymentNote.trim() || undefined,
      method: paymentMethod.trim() || undefined,
    };

    setState((prev) => ({
      ...prev,
      payments: [payment, ...prev.payments],
    }));

    setPaymentAmountInput("");
    setPaymentDate("");
    setPaymentNote("");
    setPaymentMethod("");
  };

  const totalOwedByPerson = getTotalOwedByPerson(state.purchases);
  const totalPaidByPerson = getTotalPaidByPerson(state.payments);

  const balances = state.people.map((p) => {
    const owed = totalOwedByPerson[p.id] || 0;
    const paid = totalPaidByPerson[p.id] || 0;
    const balance = owed - paid;
    return { person: p, owed, paid, balance };
  });

  const selectedPerson =
    statementPersonId &&
    state.people.find((p) => p.id === statementPersonId);

  if (!loadedFromDb) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-sm text-slate-600">Loading your data…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-8">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">
              Group Purchase Money Tracker
            </h1>
            <p className="text-sm text-slate-600">
              Track who owes you what across receipts, split items,
              status tags, and payments.
            </p>
          </div>
        </header>

        {/* PEOPLE */}
        <section className="bg-white rounded-xl shadow-sm p-4 space-y-4">
          <h2 className="text-xl font-semibold">People</h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              placeholder="Name (e.g. Lizzie)"
              value={newPersonName}
              onChange={(e) => setNewPersonName(e.target.value)}
              className="border rounded-md px-3 py-2 text-sm w-full sm:w-64"
            />
            <button
              onClick={addPerson}
              className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Add person
            </button>
          </div>
          {state.people.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {state.people.map((p) => (
                <span
                  key={p.id}
                  className="px-3 py-1 rounded-full bg-slate-100 border text-xs"
                >
                  {p.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Add the people who are part of your group purchases.
            </p>
          )}
        </section>

        {/* NEW PURCHASE */}
        <section className="bg-white rounded-xl shadow-sm p-4 space-y-4">
          <h2 className="text-xl font-semibold">New Purchase</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">
                Title
              </label>
              <input
                type="text"
                placeholder="Trader Joe's snack run"
                value={purchaseTitle}
                onChange={(e) => setPurchaseTitle(e.target.value)}
                className="border rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">
                Date
              </label>
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="border rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">
                Total Tax &amp; Fees
              </label>
              <input
                type="text"
                placeholder="e.g. 3.75"
                value={taxFeesInput}
                onChange={(e) => setTaxFeesInput(e.target.value)}
                className="border rounded-md px-3 py-2 text-sm"
              />
              <p className="text-[11px] text-slate-500">
                This will be split evenly across everyone who got at
                least one item.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">
              Notes (optional)
            </label>
            <textarea
              value={purchaseNotes}
              onChange={(e) => setPurchaseNotes(e.target.value)}
              rows={2}
              className="border rounded-md px-3 py-2 text-sm"
              placeholder="Any extra details about this purchase..."
            />
          </div>

          {/* Receipt upload */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-slate-600">
              Receipt image (optional)
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={handleReceiptUpload}
              className="text-xs"
            />
            {receiptFileName && (
              <p className="text-xs text-slate-500">
                Attached: {receiptFileName}
              </p>
            )}
            {receiptDataUrl && (
              <div className="mt-1">
                <img
                  src={receiptDataUrl}
                  alt="Receipt preview"
                  className="max-h-40 rounded-md border"
                />
              </div>
            )}
          </div>

          {/* Items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Items</h3>
              <button
                onClick={addItemRow}
                className="inline-flex items-center justify-center rounded-md border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-50"
              >
                + Add item
              </button>
            </div>
            {items.length === 0 && (
              <p className="text-xs text-slate-500">
                Add each item and select who shared it.
              </p>
            )}

            <div className="space-y-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="border rounded-lg p-3 space-y-2 bg-slate-50/40"
                >
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-medium text-slate-600">
                        Description
                      </label>
                      <input
                        type="text"
                        value={item.description}
                        onChange={(e) =>
                          updateItem(item.id, {
                            description: e.target.value,
                          })
                        }
                        placeholder="Large fries"
                        className="border rounded-md px-2 py-1 text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-medium text-slate-600">
                        Price
                      </label>
                      <input
                        type="text"
                        value={
                          item.priceCents
                            ? (item.priceCents / 100).toString()
                            : ""
                        }
                        onChange={(e) =>
                          updateItem(item.id, {
                            priceCents: parseMoneyToCents(e.target.value),
                          })
                        }
                        placeholder="5.99"
                        className="border rounded-md px-2 py-1 text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-medium text-slate-600">
                        Actions
                      </label>
                      <button
                        onClick={() => removeItem(item.id)}
                        className="inline-flex items-center justify-center rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-slate-600">
                      Who got this item?
                    </span>
                    {state.people.length === 0 ? (
                      <p className="text-[11px] text-slate-500">
                        Add people above to assign items.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {state.people.map((p) => {
                          const checked =
                            item.participantIds.includes(p.id);
                          return (
                            <label
                              key={p.id}
                              className="flex items-center gap-1 text-[11px]"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  toggleItemParticipant(item.id, p.id)
                                }
                              />
                              {p.name}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={savePurchase}
              className="inline-flex items-center justify-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Save purchase
            </button>
          </div>
        </section>

        {/* BALANCES */}
        <section className="bg-white rounded-xl shadow-sm p-4 space-y-4">
          <h2 className="text-xl font-semibold">Balances</h2>
          {state.people.length === 0 ? (
            <p className="text-sm text-slate-500">
              Add people and purchases to see who owes you what.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium border-b">
                      Person
                    </th>
                    <th className="px-3 py-2 text-right font-medium border-b">
                      Owed
                    </th>
                    <th className="px-3 py-2 text-right font-medium border-b">
                      Paid
                    </th>
                    <th className="px-3 py-2 text-right font-medium border-b">
                      Balance
                    </th>
                    <th className="px-3 py-2 text-right font-medium border-b">
                      Statement
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map(({ person, owed, paid, balance }) => (
                    <tr key={person.id} className="border-b last:border-0">
                      <td className="px-3 py-2">{person.name}</td>
                      <td className="px-3 py-2 text-right">
                        {formatCurrency(owed)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatCurrency(paid)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={
                            balance > 0
                              ? "text-rose-600 font-semibold"
                              : balance < 0
                              ? "text-emerald-600 font-semibold"
                              : "text-slate-700"
                          }
                        >
                          {formatCurrency(balance)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() =>
                            setStatementPersonId(person.id)
                          }
                          className="inline-flex items-center justify-center rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50"
                        >
                          View statement
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-slate-500 mt-2">
                Positive balance = they owe you. Negative = they&apos;ve
                overpaid you.
              </p>
            </div>
          )}
        </section>

        {/* PAYMENTS */}
        <section className="bg-white rounded-xl shadow-sm p-4 space-y-4">
          <h2 className="text-xl font-semibold">Record Payments</h2>
          <div className="grid gap-3 sm:grid-cols-5">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">
                Person
              </label>
              <select
                value={paymentPersonId}
                onChange={(e) => setPaymentPersonId(e.target.value)}
                className="border rounded-md px-3 py-2 text-sm"
              >
                <option value="">Select person</option>
                {state.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">
                Amount
              </label>
              <input
                type="text"
                placeholder="e.g. 15.00"
                value={paymentAmountInput}
                onChange={(e) => setPaymentAmountInput(e.target.value)}
                className="border rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">
                Date
              </label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="border rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">
                Method
              </label>
              <input
                type="text"
                placeholder="Venmo, Zelle, Cash..."
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="border rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">
                Note (optional)
              </label>
              <input
                type="text"
                placeholder="@handle / details"
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
                className="border rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>
          <button
            onClick={addPayment}
            className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Add payment
          </button>

          {state.payments.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold mb-2">
                Recent payments
              </h3>
              <div className="space-y-1 max-h-48 overflow-y-auto text-sm">
                {state.payments.map((pay) => {
                  const person = state.people.find(
                    (p) => p.id === pay.personId
                  );
                  return (
                    <div
                      key={pay.id}
                      className="flex justify-between border-b last:border-0 py-1 text-xs"
                    >
                      <div>
                        <div className="font-medium">
                          {person?.name ?? "Unknown"}
                        </div>
                        <div className="text-slate-500">
                          {pay.date}
                          {pay.method ? ` • ${pay.method}` : ""}
                          {pay.note ? ` • ${pay.note}` : ""}
                        </div>
                      </div>
                      <div className="text-right font-semibold">
                        {formatCurrency(pay.amountCents)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* PURCHASES LIST */}
        <section className="bg-white rounded-xl shadow-sm p-4 space-y-4 mb-8">
          <h2 className="text-xl font-semibold">All Purchases</h2>
          {state.purchases.length === 0 ? (
            <p className="text-sm text-slate-500">
              No purchases yet. Add your first one above.
            </p>
          ) : (
            <div className="space-y-4">
              {state.purchases.map((purchase) => {
                const breakdown = getPurchaseBreakdown(purchase);
                return (
                  <details
                    key={purchase.id}
                    className="border rounded-lg p-3 bg-slate-50/60"
                  >
                    <summary className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between cursor-pointer">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="font-semibold">
                            {purchase.title}
                          </div>
                          <span
                            className={
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium " +
                              (purchase.status === "open"
                                ? "bg-rose-50 text-rose-700 border border-rose-100"
                                : "bg-emerald-50 text-emerald-700 border border-emerald-100")
                            }
                          >
                            {purchase.status === "open"
                              ? "Open"
                              : "Settled"}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500">
                          {purchase.date} •{" "}
                          {Object.values(breakdown).length} participant
                          {Object.values(breakdown).length !== 1 &&
                            "s"}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-600">
                        <span>
                          Fees:{" "}
                          {formatCurrency(
                            purchase.taxAndFeesCents || 0
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            togglePurchaseStatus(purchase.id);
                          }}
                          className="inline-flex items-center justify-center rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium hover:bg-slate-50"
                        >
                          {purchase.status === "open"
                            ? "Mark settled"
                            : "Reopen"}
                        </button>
                      </div>
                    </summary>

                    <div className="mt-3 space-y-3">
                      {purchase.notes && (
                        <p className="text-xs text-slate-600">
                          Notes: {purchase.notes}
                        </p>
                      )}
                      {purchase.receiptDataUrl && (
                        <div>
                          <span className="text-[11px] font-medium text-slate-600">
                            Receipt:
                          </span>
                          <div className="mt-1">
                            <img
                              src={purchase.receiptDataUrl}
                              alt="Receipt"
                              className="max-h-48 rounded-md border"
                            />
                          </div>
                        </div>
                      )}

                      <div>
                        <h4 className="text-xs font-semibold mb-1">
                          Items
                        </h4>
                        <div className="space-y-1 text-xs">
                          {purchase.items.map((item) => (
                            <div
                              key={item.id}
                              className="flex justify-between"
                            >
                              <div>
                                <span className="font-medium">
                                  {item.description}
                                </span>{" "}
                                •{" "}
                                <span className="text-slate-600">
                                  {formatCurrency(item.priceCents)}
                                </span>
                                {item.participantIds.length > 0 && (
                                  <span className="text-slate-500">
                                    {" "}
                                    •{" "}
                                    {item.participantIds
                                      .map(
                                        (pid) =>
                                          state.people.find(
                                            (p) => p.id === pid
                                          )?.name ?? "Unknown"
                                      )
                                      .join(", ")}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h4 className="text-xs font-semibold mb-1">
                          Split for this purchase
                        </h4>
                        <div className="space-y-1 text-xs">
                          {Object.entries(breakdown).map(
                            ([pid, amount]) => {
                              const person = state.people.find(
                                (p) => p.id === pid
                              );
                              return (
                                <div
                                  key={pid}
                                  className="flex justify-between"
                                >
                                  <span>
                                    {person?.name ?? "Unknown"}
                                  </span>
                                  <span className="font-semibold">
                                    {formatCurrency(amount)}
                                  </span>
                                </div>
                              );
                            }
                          )}
                        </div>
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* person statement modal */}
      {selectedPerson && (
        <PersonStatementModal
          person={selectedPerson}
          purchases={state.purchases}
          payments={state.payments}
          onClose={() => setStatementPersonId(null)}
        />
      )}
    </div>
  );
};

export default MoneyTrackerApp;

