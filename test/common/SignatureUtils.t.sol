// SPDX-License-Identifier: MIT
pragma solidity >=0.4.24 <0.9.0;

import "forge-std/Test.sol";
import {ECDSA} from "contracts/common/lib/ECDSA.sol";
import {SignatureUtils} from "contracts/common/lib/SignatureUtils.sol";

contract ExposedSignatureUtils {
    function isValidSignature(
        address signer,
        bytes32 msgHash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public view returns (bool) {
        return SignatureUtils.isValidSignature(signer, msgHash, v, r, s);
    }

    function hasCode(address addr) public view returns (bool) {
        return SignatureUtils._hasCode(addr);
    }
}

contract SignatureUtilsTest is Test {
    ExposedSignatureUtils public sigUtil;

    function ethMessageHash(string memory message) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", message)
        );
    }

    function setUp() public {
        sigUtil = new ExposedSignatureUtils();
    }

    function test_hasCode_Works() public {
        address eoa = 0xbeFA429d57cD18b7F8A4d91A2da9AB4AF05d0FBe;
        address con = address(new ExposedSignatureUtils());

        assertEq(sigUtil.hasCode(eoa), false);
        assertEq(sigUtil.hasCode(con), true);
    }

    function test_isValidSignature_Eoa() public {
        uint256 eoaPk = 1;
        address eoa = vm.addr(eoaPk);
        bytes32 hash = keccak256("TEST");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(eoaPk, hash);

        assertEq(sigUtil.isValidSignature(eoa, hash, v, r, s), true);
    }

    function testFuzz_isValidSignature_EoaNum(uint256 eoa_num) public {
        // Private key must be less than the secp256k1 curve order
        vm.assume(eoa_num < 115792089237316195423570985008687907852837564279074904382605163141518161494337);

        //Private key cannot be zero
        vm.assume(eoa_num > 0);

        bytes32 hash = keccak256("TEST");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(eoa_num, hash);

        assertEq(sigUtil.isValidSignature(vm.addr(eoa_num), hash, v, r, s), true);
    }

    function testFuzz_isValidSignature_Message(bytes memory data) public {
        uint256 eoaPk = 1;
        address eoa = vm.addr(eoaPk);
        bytes32 hash = keccak256(data);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(eoaPk, hash);

        // Regardless of the message, it should always validate
        assertEq(sigUtil.isValidSignature(eoa, hash, v, r, s), true);
    }

    function testFuzz_isValidSignature_V(uint8 _v) public {
        uint256 eoaPk = 1;
        address eoa = vm.addr(eoaPk);
        bytes32 hash = keccak256("TEST");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(eoaPk, hash);

        // Test to see if we can get valid signatures without a valid V
        if (v == _v) {
            assertEq(sigUtil.isValidSignature(eoa, hash, _v, r, s), true);
        } else if (27 == _v) {
            assertEq(sigUtil.isValidSignature(eoa, hash, _v, r, s), false);
        } else {
            vm.expectRevert(bytes("ECDSA: invalid signature"));
            sigUtil.isValidSignature(eoa, hash, _v, r, s);
        }
    }

    function testFuzz_isValidSignature_R(bytes32 _r) public {
        uint256 eoaPk = 1;
        address eoa = vm.addr(eoaPk);
        bytes32 hash = keccak256("TEST");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(eoaPk, hash);

        // Test to see if we can get valid signatures regardless of what R is
        if (r == _r) {
            assertEq(sigUtil.isValidSignature(eoa, hash, v, _r, s), true);
        } else if (ecrecover(hash, v, _r, s) == address(0)) {
            vm.expectRevert(bytes("ECDSA: invalid signature"));
            sigUtil.isValidSignature(eoa, hash, v, _r, s);
        } else {
            assertEq(sigUtil.isValidSignature(eoa, hash, v, _r, s), false);
        }
    }

    function testFuzz_isValidSignature_S(bytes32 _s) public {
        uint256 eoaPk = 1;
        address eoa = vm.addr(eoaPk);
        bytes32 hash = keccak256("TEST");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(eoaPk, hash);

        // Test to see if we can get valid signatures regardless of what S is
        if (s == _s) {
            assertEq(sigUtil.isValidSignature(eoa, hash, v, r, _s), true);
        } else if (uint256(_s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            vm.expectRevert(bytes("ECDSA: invalid signature 's' value"));
            sigUtil.isValidSignature(eoa, hash, v, r, _s);
        } else if (ecrecover(hash, v, r, _s) == address(0)) {
            vm.expectRevert(bytes("ECDSA: invalid signature"));
            sigUtil.isValidSignature(eoa, hash, v, r, _s);
        } else {
            assertEq(sigUtil.isValidSignature(eoa, hash, v, r, _s), false);
        }
    }

    function test_isValidSignature_WrongSigner(uint256 rogueSigner) public {
        // Ignore the 0 case for rogue signer
        vm.assume(rogueSigner != 0);

        // Ignore signers above secp256k1 curve order
        vm.assume(rogueSigner < 115792089237316195423570985008687907852837564279074904382605163141518161494337);

        uint256 eoaPk = 1;
        address eoa = vm.addr(eoaPk);
        address eoa2 = vm.addr(rogueSigner);

        bytes32 hash = keccak256("TEST");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(eoaPk, hash);

        if (eoa == eoa2) {
            assertEq(sigUtil.isValidSignature(eoa2, hash, v, r, s), true);
        } else {
            assertEq(sigUtil.isValidSignature(eoa2, hash, v, r, s), false);
        }
    }
}
