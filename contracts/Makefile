-include .env
export

RPC ?= $(UNICHAIN_SEPOLIA_RPC_URL)
FORGE_STD = 15b2df92a05d4d2f76a06653872fefb287e0e01c
V4_PERIPHERY = c6e4754dab11bd38c6f08ac51c3c868569e93d64

.PHONY: install build test deploy activity verify clean

# pinned deps, works from a plain zip (no git repo needed)
install:
	rm -rf lib && mkdir -p lib
	git clone -q https://github.com/foundry-rs/forge-std lib/forge-std && git -C lib/forge-std checkout -q $(FORGE_STD)
	git clone -q https://github.com/Uniswap/v4-periphery lib/v4-periphery && git -C lib/v4-periphery checkout -q $(V4_PERIPHERY)
	git -C lib/v4-periphery submodule update --init --recursive -q

build:
	forge build

# the script test embeds the whole stack in one contract, so lift EIP-170 for tests only
test:
	FOUNDRY_DISABLE_CODE_SIZE_LIMIT=true forge test -vv

deploy:
	forge script script/Deploy.s.sol --rpc-url $(RPC) --broadcast --slow

activity:
	forge script script/Activity.s.sol --rpc-url $(RPC) --broadcast --slow

clean:
	forge clean
