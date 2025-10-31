// components/TransactionDrawer.tsx
"use client";

import React from "react";

type Props = {
    tx: any | null;
    onClose?: () => void;
};

export default function TransactionDrawer({ tx, onClose }: Props) {
    if (!tx) return null;

    return (
        <div className="fixed inset-0 z-50 flex">
            <div className="flex-1" onClick={onClose} />
            <aside className="w-[420px] bg-white dark:bg-slate-800 p-4 shadow-xl overflow-auto">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold">Transaction / Intent</h3>
                    <button onClick={onClose} className="text-sm px-2 py-1 rounded bg-gray-200 dark:bg-slate-700">Close</button>
                </div>

                <div className="text-sm text-gray-600 mb-4">
                    {tx.intentId ? (
                        <>
                            <div><strong>Intent ID:</strong> {tx.intentId}</div>
                            <div><strong>Status:</strong> {tx.status ?? "unknown"}</div>
                            <div className="mt-2"><strong>Raw metadata</strong></div>
                            <pre className="text-xs bg-gray-100 dark:bg-slate-900 p-2 rounded mt-2 max-h-56 overflow-auto">
                                {JSON.stringify(tx, null, 2)}
                            </pre>
                        </>
                    ) : (
                        <>
                            <div><strong>Note:</strong> {tx.note ?? "No data"}</div>
                            <div className="mt-2"><strong>Message text:</strong></div>
                            <pre className="text-xs bg-gray-100 dark:bg-slate-900 p-2 rounded mt-2">{tx.message}</pre>
                            <div className="mt-2"><strong>Meta</strong></div>
                            <pre className="text-xs bg-gray-100 dark:bg-slate-900 p-2 rounded mt-2">{JSON.stringify(tx.meta ?? {}, null, 2)}</pre>
                        </>
                    )}
                </div>

                <div className="flex gap-2">
                    <a
                        className="flex-1 text-center py-2 rounded bg-blue-600 text-white"
                        target="_blank"
                        rel="noreferrer"
                        href={tx.explorer_url ?? "#"}
                    >
                        Open in Explorer
                    </a>
                    <button className="flex-1 py-2 rounded border" onClick={() => navigator.clipboard?.writeText(JSON.stringify(tx))}>
                        Copy JSON
                    </button>
                </div>
            </aside>
        </div>
    );
}
