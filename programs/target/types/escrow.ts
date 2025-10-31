/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/escrow.json`.
 */
export type Escrow = {
  "address": "EBZZtxXYjmWM7qRXrVDAh7BPDe38NhQiEnScFLUMQ9PE",
  "metadata": {
    "name": "escrow",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "createIntent",
      "docs": [
        "Create an intent PDA and move `amount` lamports into it.",
        "`expiry` is unix timestamp (i64). `payload_hash` is 32-byte hash of payload."
      ],
      "discriminator": [
        216,
        214,
        79,
        121,
        23,
        194,
        96,
        104
      ],
      "accounts": [
        {
          "name": "intent",
          "docs": [
            "Intent PDA (will be funded by the sender)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  116,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "sender"
              },
              {
                "kind": "account",
                "path": "receiver"
              },
              {
                "kind": "arg",
                "path": "expiry"
              }
            ]
          }
        },
        {
          "name": "sender",
          "docs": [
            "The payer and signer (who funds the intent)"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "receiver",
          "docs": [
            "or access its data here. It is later validated when the receiver signs",
            "to finalize the intent."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "payloadHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "expiry",
          "type": "i64"
        }
      ]
    },
    {
      "name": "finalizeIntent",
      "docs": [
        "Finalize the intent. Only the `receiver` (signer) can finalize.",
        "Closing the intent account (close = receiver) will transfer all lamports to receiver."
      ],
      "discriminator": [
        44,
        63,
        228,
        164,
        157,
        34,
        110,
        61
      ],
      "accounts": [
        {
          "name": "intent",
          "docs": [
            "Intent PDA; close to receiver when instruction ends"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  116,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "intent.sender",
                "account": "intent"
              },
              {
                "kind": "account",
                "path": "intent.receiver",
                "account": "intent"
              },
              {
                "kind": "account",
                "path": "intent.expiry",
                "account": "intent"
              }
            ]
          }
        },
        {
          "name": "receiver",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "proof",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "refundIntent",
      "docs": [
        "Refund an expired intent to the sender. Only the `sender` (signer) may call after expiry.",
        "Closing the intent account (close = sender) will transfer lamports to sender."
      ],
      "discriminator": [
        9,
        169,
        53,
        75,
        239,
        171,
        250,
        21
      ],
      "accounts": [
        {
          "name": "intent",
          "docs": [
            "Intent PDA; close to sender when instruction ends"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  116,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "intent.sender",
                "account": "intent"
              },
              {
                "kind": "account",
                "path": "intent.receiver",
                "account": "intent"
              },
              {
                "kind": "account",
                "path": "intent.expiry",
                "account": "intent"
              }
            ]
          }
        },
        {
          "name": "sender",
          "writable": true,
          "signer": true
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "intent",
      "discriminator": [
        247,
        162,
        35,
        165,
        254,
        111,
        129,
        109
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "alreadyFinalized",
      "msg": "Already finalized"
    },
    {
      "code": 6001,
      "name": "notExpired",
      "msg": "Not yet expired"
    }
  ],
  "types": [
    {
      "name": "intent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sender",
            "type": "pubkey"
          },
          {
            "name": "receiver",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "payloadHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "expiry",
            "type": "i64"
          },
          {
            "name": "finalized",
            "type": "bool"
          }
        ]
      }
    }
  ]
};
