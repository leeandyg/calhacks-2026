// Captured Gemini tool calls for the offline demo. No API credentials or provider signatures.
export const demoRecordings = {
  "model": "gemini-3.8-flash",
  "recordedAt": "2026-10-24",
  "note": "Real agent tool responses, with fixed local-pack bindings. Edits are rebound to current IDs and volume so manual changes survive.",
  "rainIncrease": 0.25,
  "assets": {
    "rain-window": "rain_window",
    "brown-noise": "brown_noise",
    "cafe-ambience": "cafe_murmur",
    "cup-clinks": "cup_clink",
    "rain-bed": "rain_heavy",
    "cozy-fireplace": "fireplace"
  },
  "responses": {
    "cafe": {
      "kind": "create",
      "scene": {
        "room": {
          "reverb": "small-room",
          "preset": "cafe",
          "grid": { "mode": "Square", "columns": 10, "rows": 10, "wallHeight": 7 },
          "openings": []
        },
        "listener": {
          "yaw": 0,
          "position": [
            0,
            1.6,
            0
          ]
        },
        "objects": [
          {
            "sound": {
              "query": "steady gentle rain against a cafe glass window"
            },
            "id": "rain-window",
            "label": "Rain on Window",
            "position": [
              -1.8,
              1.6,
              -0.8
            ],
            "kind": "bed",
            "volume": 0.55
          },
          {
            "kind": "bed",
            "position": [
              1.8,
              1.6,
              -0.5
            ],
            "volume": 0.45,
            "id": "brown-noise",
            "sound": {
              "query": "smooth deep warm brown noise static"
            },
            "label": "Warm Brown Noise"
          },
          {
            "kind": "bed",
            "sound": {
              "query": "gentle muffled cafe background walla unintelligible quiet room tone"
            },
            "label": "Indistinct Cafe Murmur",
            "volume": 0.35,
            "id": "cafe-ambience",
            "position": [
              0,
              1.5,
              2.2
            ]
          },
          {
            "volume": 0.2,
            "id": "cup-clinks",
            "intervalSec": [
              12,
              28
            ],
            "label": "Cup Clinks",
            "position": [
              2.8,
              1.1,
              -2.5
            ],
            "sound": {
              "query": "occasional ceramic coffee cup and saucer clink porcelain tableware"
            },
            "kind": "event"
          }
        ],
        "session": {
          "task": "Writing essay",
          "mode": "focus",
          "minutesLeft": 45
        }
      }
    },
    "rainier": {
      "kind": "edit",
      "ops": [
        {
          "op": "set_volume",
          "id": "rain-window",
          "volume": 0.8
        }
      ]
    },
    "rainAddition": {
      "kind": "edit",
      "ops": [
        {
          "object": {
            "volume": 0.5,
            "sound": {
              "query": "steady rainfall on forest canopy and leaves continuous loop"
            },
            "id": "rain-bed",
            "kind": "bed",
            "position": [
              -1.5,
              2.2,
              -1
            ],
            "label": "Rain on Leaves"
          },
          "op": "add"
        }
      ]
    },
    "fireplace": {
      "kind": "edit",
      "ops": [
        {
          "op": "move",
          "id": "cafe-ambience",
          "position": [
            0,
            1.5,
            3.2
          ]
        },
        {
          "op": "add",
          "object": {
            "id": "cozy-fireplace",
            "label": "Fireplace",
            "sound": {
              "query": "warm crackling fireplace hearth wood embers burning gently"
            },
            "position": [
              -2.2,
              0.8,
              -2.2
            ],
            "volume": 0.5,
            "kind": "bed"
          }
        }
      ]
    }
  }
} as const;
