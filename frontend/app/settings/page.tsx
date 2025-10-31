// app/settings/page.tsx
"use client";

import React, { useEffect, useState } from "react";

const STORAGE_KEY = "mvp_receiving_sol";

export default function SettingsPage() {
    const [receivingSol, setReceivingSol] = useState<number>(0.09);
    const [network, setNetwork] = useState<string>("devnet");

    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = Number(stored);
            if (!Number.isNaN(parsed)) setReceivingSol(parsed);
        } else {
            // ensure default persists
            localStorage.setItem(STORAGE_KEY, String(0.09));
        }
    }, []);

    function save() {
        localStorage.setItem(STORAGE_KEY, String(receivingSol));
        alert("Settings saved (localStorage).");
    }

    return (
        <div className="p-6">
            <header className="mb-6">
                <h1 className="text-xl font-bold">Settings</h1>
            </header>

            <div className="max-w-xl bg-white dark:bg-slate-800 p-4 rounded shadow-sm">
                <label className="block text-sm text-gray-600 mb-1">Default Receiving SOL</label>
                <input
                    type="number"
                    step="0.0001"
                    value={receivingSol}
                    onChange={(e) => setReceivingSol(Number(e.target.value))}
                    className="w-full p-2 rounded mb-3"
                />

                <label className="block text-sm text-gray-600 mb-1">Network</label>
                <select value={network} onChange={(e) => setNetwork(e.target.value)} className="w-full p-2 rounded mb-3">
                    <option value="localnet">localnet</option>
                    <option value="devnet">devnet</option>
                    <option value="mainnet">mainnet</option>
                </select>

                <div className="flex gap-2">
                    <button onClick={save} className="px-4 py-2 bg-blue-600 text-white rounded">Save</button>
                    <button onClick={() => { setReceivingSol(0.09); alert("Reset to default 0.09 SOL"); }} className="px-4 py-2 border rounded">Reset</button>
                </div>
            </div>
        </div>
    );
}
