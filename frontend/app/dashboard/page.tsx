// app/dashboard/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import Panel from "@/components/Panel";
import TransactionDrawer from "@/components/TransactionDrawer";

type Balance = { currency: string; value: number };
type Intent = { intent_id: string; from: string; amountSol?: number; payload?: any; expires_at?: string };
type Tx = { tx_id: string; type: string; amount?: number; counterparty?: string; status?: string; timestamp?: string };

const DEFAULT_RECEIVING_SOL = 0.09; // default receiving SOL requested

export default function DashboardPage() {
    const [balances, setBalances] = useState<Balance[]>([{ currency: "SOL", value: 0.09 }, { currency: "USDC", value: 0 }]);
    const [queue, setQueue] = useState<Intent[]>([]);
    const [txs, setTxs] = useState<Tx[]>([]);
    const [selectedIntent, setSelectedIntent] = useState<Intent | null>(null);
    const [drawerTx, setDrawerTx] = useState<any | null>(null);

    useEffect(() => {
        // mock load
        setTimeout(() => {
            setQueue([
                { intent_id: "intent-abc-1", from: "http://localhost:3002", amountSol: 0.5, payload: { task: "summarize", text: "Short summary" }, expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() },
            ]);
            setTxs([
                { tx_id: "tx111", type: "create_intent", amount: 0.5, counterparty: "agent-B", status: "confirmed", timestamp: new Date().toISOString() },
            ]);
        }, 200);
    }, []);

    return (
        <div className="p-6">
            <header className="flex items-center justify-between mb-6">
                <h1 className="text-xl font-bold">Dashboard</h1>
                <div className="text-sm text-gray-600">Network: devnet (mock)</div>
            </header>

            <div className="grid grid-cols-3 gap-4 mb-6">
                {balances.map((b) => (
                    <div key={b.currency} className="p-4 bg-white dark:bg-slate-800 rounded shadow-sm">
                        <div className="text-xs text-gray-500">Balance — {b.currency}</div>
                        <div className="text-2xl font-mono">{b.value} {b.currency}</div>
                    </div>
                ))}
            </div>

            <div className="grid md:grid-cols-2 gap-6">
                <section className="bg-white dark:bg-slate-800 p-4 rounded shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="font-semibold">Approval Queue</h2>
                        <div className="text-xs text-gray-500">Pending</div>
                    </div>
                    {queue.length === 0 && <div className="text-gray-400">No pending intents</div>}
                    {queue.map((i) => (
                        <div key={i.intent_id} className="p-3 border rounded mb-3">
                            <div className="flex justify-between items-center">
                                <div>
                                    <div className="text-sm font-mono break-all">{i.intent_id}</div>
                                    <div className="text-xs text-gray-500">From: {i.from}</div>
                                </div>
                                <div className="text-right">
                                    <div className="font-semibold">{i.amountSol ?? DEFAULT_RECEIVING_SOL} SOL</div>
                                    <div className="text-xs text-gray-400">{new Date(i.expires_at ?? Date.now()).toLocaleTimeString()}</div>
                                </div>
                            </div>

                            <div className="mt-3 flex gap-2">
                                <button onClick={() => setSelectedIntent(i)} className="px-3 py-1 bg-blue-600 text-white rounded text-sm">Review</button>
                                <button onClick={() => { alert("Deny (mock)"); }} className="px-3 py-1 border rounded text-sm">Deny</button>
                            </div>
                        </div>
                    ))}
                </section>

                <section className="bg-white dark:bg-slate-800 p-4 rounded shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="font-semibold">Transaction History</h2>
                        <div className="text-xs text-gray-500">Recent</div>
                    </div>

                    {txs.map((t) => (
                        <div key={t.tx_id} className="py-2 border-b last:border-b-0 flex justify-between items-center">
                            <div>
                                <div className="text-sm font-mono">{t.tx_id}</div>
                                <div className="text-xs text-gray-500">{t.type} • {t.counterparty}</div>
                            </div>
                            <div className="text-right">
                                <div className="font-semibold">{t.amount ?? "-"} SOL</div>
                                <div className="text-xs text-gray-400">{t.status}</div>
                                <button onClick={() => setDrawerTx(t)} className="mt-2 text-xs px-2 py-1 rounded border">Inspect</button>
                            </div>
                        </div>
                    ))}
                </section>
            </div>

            {selectedIntent && <Panel intent={{ intentId: selectedIntent.intent_id, from: selectedIntent.from, payload: selectedIntent.payload }} onClose={() => setSelectedIntent(null)} />}

            <TransactionDrawer tx={drawerTx} onClose={() => setDrawerTx(null)} />
        </div>
    );
}
