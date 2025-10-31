// components/Panel.tsx
"use client";

import React, { useState } from "react";

type Props = {
    intent: { intentId: string; from: string; payload?: any } | null;
    onClose?: () => void;
};

export default function Panel({ intent, onClose }: Props) {
    const [approving, setApproving] = useState(false);
    if (!intent) return null;

    async function handleApprove() {
        setApproving(true);
        try {
            // Replace with your backend POST to approve
            await fetch(`/api/approve-intent`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ intentId: intent.intentId, approve: true }),
            });
            // simple confirmation UI
            alert("Approved (mock) — backend should create/sign tx.");
            onClose?.();
        } catch (err) {
            alert("Approve failed: " + String(err));
        } finally {
            setApproving(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={onClose} />
            <div className="relative w-full md:w-[720px] bg-white dark:bg-slate-800 rounded-t-lg md:rounded-lg p-6 z-10">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">Review Intent</h2>
                    <button onClick={onClose} className="px-2 py-1 rounded bg-gray-200 dark:bg-slate-700">Close</button>
                </div>

                <div className="mb-4">
                    <div className="text-sm text-gray-600"><strong>Intent ID</strong></div>
                    <div className="font-mono text-sm break-all">{intent.intentId}</div>

                    <div className="mt-3 text-sm text-gray-600"><strong>From</strong></div>
                    <div className="text-sm">{intent.from}</div>

                    <div className="mt-3 text-sm text-gray-600"><strong>Payload</strong></div>
                    <pre className="text-xs bg-gray-100 dark:bg-slate-900 p-3 rounded mt-2 max-h-48 overflow-auto">{JSON.stringify(intent.payload ?? {}, null, 2)}</pre>
                </div>

                <div className="flex gap-2">
                    <button onClick={handleApprove} disabled={approving} className="px-4 py-2 bg-blue-600 text-white rounded">
                        {approving ? "Approving…" : "Approve & Sign"}
                    </button>
                    <button onClick={() => { alert("Denied (mock)."); onClose?.(); }} className="px-4 py-2 border rounded">
                        Deny
                    </button>
                    <button onClick={() => { navigator.clipboard?.writeText(JSON.stringify(intent)); alert("Copied."); }} className="px-3 py-2 border rounded">
                        Copy Payload
                    </button>
                </div>
            </div>
        </div>
    );
}
