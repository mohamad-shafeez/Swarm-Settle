.PHONY: verify test-invariants check contract-test contract-build app-install app-build app-dev demo-record

verify:
	node scripts/verify.mjs

test-invariants:
	node scripts/test-contract-invariants.mjs

check: test-invariants verify app-build

contract-test:
	cd contract && cargo test

contract-build:
	cd contract && cargo near build non-reproducible-wasm

app-install:
	cd app && npm install

app-build:
	cd app && npm run build

app-dev:
	cd app && npm run dev

demo-record:
	node scripts/record-demo.mjs
