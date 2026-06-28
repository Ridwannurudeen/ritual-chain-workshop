// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AIJudge} from "./AIJudge.sol";

contract AIJudgeTest is Test {
    AIJudge internal judge;

    address internal owner = address(this);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    uint256 internal start = 1_000_000;
    uint256 internal deadline = start + 1_000;
    uint256 internal revealDeadline = start + 2_000;
    uint256 internal bountyId;

    // LLM precompile address (mirrors PrecompileConsumer.LLM_INFERENCE_PRECOMPILE).
    address internal constant LLM = address(0x0802);

    function setUp() public {
        vm.warp(start);
        judge = new AIJudge();
        vm.deal(owner, 10 ether);
        bountyId = judge.createBounty{value: 1 ether}(
            "Best haiku",
            "Most evocative wins",
            deadline,
            revealDeadline
        );
    }

    // ---- helpers ----------------------------------------------------------

    function _commitmentFor(
        string memory answer,
        bytes32 salt,
        address who
    ) internal view returns (bytes32) {
        return keccak256(abi.encode(answer, salt, who, bountyId));
    }

    function _commit(address who, string memory answer, bytes32 salt) internal {
        vm.prank(who);
        judge.submitCommitment(bountyId, _commitmentFor(answer, salt, who));
    }

    function _reveal(address who, string memory answer, bytes32 salt) internal {
        vm.prank(who);
        judge.revealAnswer(bountyId, answer, salt);
    }

    /// Stub the Ritual LLM precompile so judgeAll can run off Ritual chain.
    /// _executePrecompile expects abi.encode(simmedInput, actualOutput); the
    /// contract then decodes actualOutput as (bool, bytes, bytes, string, ConvoHistory).
    function _mockLlm(uint256 winnerIndex) internal {
        bytes memory completion = abi.encodePacked(
            '{"winnerIndex":',
            vm.toString(winnerIndex),
            ',"summary":"ok"}'
        );
        AIJudge.ConvoHistory memory ch = AIJudge.ConvoHistory("", "", "");
        bytes memory actualOutput = abi.encode(
            false,
            completion,
            bytes(""),
            string(""),
            ch
        );
        bytes memory rawOutput = abi.encode(bytes(""), actualOutput);
        vm.mockCall(LLM, "", rawOutput);
    }

    // ---- commit / reveal happy path --------------------------------------

    function test_CommitThenRevealStoresAnswer() public {
        bytes32 salt = keccak256("salt-a");
        _commit(alice, "petals fall softly", salt);

        // During the commit phase the answer is not on-chain: no submissions yet.
        (, , , , , , , , uint256 subCount, uint256 commitCount, , ) = judge
            .getBounty(bountyId);
        assertEq(subCount, 0, "no plaintext before reveal");
        assertEq(commitCount, 1, "commitment counted");

        vm.warp(deadline);
        _reveal(alice, "petals fall softly", salt);

        (address submitter, string memory answer) = judge.getSubmission(
            bountyId,
            0
        );
        assertEq(submitter, alice);
        assertEq(answer, "petals fall softly");
    }

    // ---- reveal failure cases --------------------------------------------

    function test_RevealWrongSaltReverts() public {
        bytes32 salt = keccak256("real");
        _commit(alice, "answer", salt);
        vm.warp(deadline);
        vm.prank(alice);
        vm.expectRevert("commitment mismatch");
        judge.revealAnswer(bountyId, "answer", keccak256("wrong"));
    }

    function test_RevealWrongAnswerReverts() public {
        bytes32 salt = keccak256("real");
        _commit(alice, "answer", salt);
        vm.warp(deadline);
        vm.prank(alice);
        vm.expectRevert("commitment mismatch");
        judge.revealAnswer(bountyId, "tampered answer", salt);
    }

    function test_OtherSenderCannotRevealSomeoneElsesAnswer() public {
        bytes32 salt = keccak256("real");
        _commit(alice, "answer", salt);
        vm.warp(deadline);
        // Bob never committed; the hash is bound to msg.sender so alice's
        // (answer, salt) is useless to him.
        vm.prank(bob);
        vm.expectRevert("nothing to reveal");
        judge.revealAnswer(bountyId, "answer", salt);
    }

    function test_RevealBeforeDeadlineReverts() public {
        bytes32 salt = keccak256("real");
        _commit(alice, "answer", salt);
        // still in commit phase
        vm.prank(alice);
        vm.expectRevert("reveal not open");
        judge.revealAnswer(bountyId, "answer", salt);
    }

    function test_RevealAfterRevealDeadlineReverts() public {
        bytes32 salt = keccak256("real");
        _commit(alice, "answer", salt);
        vm.warp(revealDeadline);
        vm.prank(alice);
        vm.expectRevert("reveal phase over");
        judge.revealAnswer(bountyId, "answer", salt);
    }

    function test_DoubleRevealReverts() public {
        bytes32 salt = keccak256("real");
        _commit(alice, "answer", salt);
        vm.warp(deadline);
        _reveal(alice, "answer", salt);
        vm.prank(alice);
        vm.expectRevert("nothing to reveal");
        judge.revealAnswer(bountyId, "answer", salt);
    }

    function test_RevealTooLongAnswerReverts() public {
        string memory long = string(new bytes(2_001));
        bytes32 salt = keccak256("real");
        _commit(alice, long, salt);
        vm.warp(deadline);
        vm.prank(alice);
        vm.expectRevert("answer too long");
        judge.revealAnswer(bountyId, long, salt);
    }

    function test_RecommitOverwritesAndOnlyLatestReveals() public {
        bytes32 saltA = keccak256("A");
        bytes32 saltB = keccak256("B");
        _commit(alice, "first", saltA);
        _commit(alice, "second", saltB); // overwrite, same slot

        (, , , , , , , , , uint256 commitCount, , ) = judge.getBounty(bountyId);
        assertEq(commitCount, 1, "re-commit does not consume a new slot");

        vm.warp(deadline);
        vm.prank(alice);
        vm.expectRevert("commitment mismatch");
        judge.revealAnswer(bountyId, "first", saltA); // old answer no longer valid

        _reveal(alice, "second", saltB);
        (, string memory answer) = judge.getSubmission(bountyId, 0);
        assertEq(answer, "second");
    }

    // ---- commit failure cases --------------------------------------------

    function test_CommitAfterDeadlineReverts() public {
        vm.warp(deadline);
        vm.prank(alice);
        vm.expectRevert("commit phase over");
        judge.submitCommitment(bountyId, keccak256("x"));
    }

    function test_EmptyCommitmentReverts() public {
        vm.prank(alice);
        vm.expectRevert("empty commitment");
        judge.submitCommitment(bountyId, bytes32(0));
    }

    function test_CommitmentCapEnforced() public {
        for (uint256 i = 0; i < 10; i++) {
            address who = address(uint160(i + 100));
            vm.prank(who);
            judge.submitCommitment(bountyId, keccak256(abi.encode(i)));
        }
        vm.prank(address(uint160(999)));
        vm.expectRevert("too many submissions");
        judge.submitCommitment(bountyId, keccak256("overflow"));
    }

    // ---- judging gating (pre-precompile reverts) -------------------------

    function test_JudgeBeforeRevealDeadlineReverts() public {
        bytes32 salt = keccak256("s");
        _commit(alice, "a", salt);
        vm.warp(deadline);
        _reveal(alice, "a", salt);
        // reveal phase still open
        vm.expectRevert("reveal phase not over");
        judge.judgeAll(bountyId, "");
    }

    function test_JudgeWithNoSubmissionsReverts() public {
        vm.warp(revealDeadline);
        vm.expectRevert("no submissions");
        judge.judgeAll(bountyId, "");
    }

    function test_JudgeNotOwnerReverts() public {
        bytes32 salt = keccak256("s");
        _commit(alice, "a", salt);
        vm.warp(deadline);
        _reveal(alice, "a", salt);
        vm.warp(revealDeadline);
        vm.prank(bob);
        vm.expectRevert("not bounty owner");
        judge.judgeAll(bountyId, "");
    }

    // ---- full lifecycle with mocked precompile ---------------------------

    function test_JudgeAndFinalizePaysWinner() public {
        bytes32 sa = keccak256("sa");
        bytes32 sb = keccak256("sb");
        _commit(alice, "alice answer", sa);
        _commit(bob, "bob answer", sb);

        vm.warp(deadline);
        _reveal(alice, "alice answer", sa);
        _reveal(bob, "bob answer", sb);

        vm.warp(revealDeadline);
        _mockLlm(1); // pretend the model picked submission #1 (bob)
        judge.judgeAll(bountyId, "ignored-by-mock");

        (, , , , , , bool judged, , , , , ) = judge.getBounty(bountyId);
        assertTrue(judged, "judged flag set");

        uint256 bobBefore = bob.balance;
        judge.finalizeWinner(bountyId, 1);
        assertEq(bob.balance, bobBefore + 1 ether, "winner paid the reward");

        (, , , , , , , bool finalized, , , uint256 winnerIndex, ) = judge
            .getBounty(bountyId);
        assertTrue(finalized, "finalized flag set");
        assertEq(winnerIndex, 1);
    }

    function test_FinalizeBeforeJudgeReverts() public {
        bytes32 salt = keccak256("s");
        _commit(alice, "a", salt);
        vm.warp(deadline);
        _reveal(alice, "a", salt);
        vm.warp(revealDeadline);
        vm.expectRevert("not judged yet");
        judge.finalizeWinner(bountyId, 0);
    }

    // Needed because finalizeWinner pays the winner; if the test contract were
    // ever the winner it must be able to receive ETH.
    receive() external payable {}
}
