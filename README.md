# Solana Mainnet Independent Cloud Witness

This repository runs an automated GitHub Actions workflow on a neutral Microsoft Azure / GitHub runner (`ubuntu-latest`) that queries the official Solana Mainnet RPC (`https://api.mainnet-beta.solana.com`).

The resulting JSON-RPC batch payload (`LIVE_MAINNET_CLOUD_WITNESS.json`) and run metadata (`CLOUD_WITNESS_META.txt`) are committed directly by `github-actions[bot]`.
