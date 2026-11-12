.PHONY: verify test-invariants demo-check contract-test contract-build app-build

verify:
	bash scripts/verify.sh

test-invariants:
	node --test scripts/test-contract-invariants.mjs

demo-check:
	node scripts/demo-check.mjs

contract-test:
	cd contract && cargo test

contract-build:
	cd contract && cargo near build non-reproducible-wasm

app-build:
	cd app && npm install && npm run build
