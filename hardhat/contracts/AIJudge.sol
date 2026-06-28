// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PrecompileConsumer} from "./utils/PrecompileConsumer.sol";

contract AIJudge is PrecompileConsumer {
    uint256 public constant MAX_SUBMISSIONS = 10;
    uint256 public constant MAX_ANSWER_LENGTH = 2_000;

    uint256 public nextBountyId = 1;

    struct Submission {
        address submitter;
        string answer;
    }

    struct Bounty {
        address owner;
        string title;
        string rubric;
        uint256 reward;
        uint256 deadline; // commit phase ends here
        uint256 revealDeadline; // reveal phase ends here
        bool judged;
        bool finalized;
        bytes aiReview;
        uint256 winnerIndex;
        uint256 commitmentCount;
        Submission[] submissions; // revealed answers only
    }

    struct ConvoHistory {
        string storageType;
        string path;
        string secretsName;
    }

    mapping(uint256 => Bounty) public bounties;

    // bountyId => participant => commitment hash. Cleared on reveal.
    mapping(uint256 => mapping(address => bytes32)) public commitmentOf;

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed owner,
        string title,
        uint256 reward,
        uint256 deadline,
        uint256 revealDeadline
    );

    event CommitmentSubmitted(
        uint256 indexed bountyId,
        address indexed submitter,
        bytes32 commitment
    );

    event AnswerRevealed(
        uint256 indexed bountyId,
        uint256 indexed submissionIndex,
        address indexed submitter
    );

    event AllAnswersJudged(uint256 indexed bountyId, bytes aiReview);

    event WinnerFinalized(
        uint256 indexed bountyId,
        uint256 indexed winnerIndex,
        address indexed winner,
        uint256 reward
    );

    modifier onlyOwner(uint256 bountyId) {
        require(msg.sender == bounties[bountyId].owner, "not bounty owner");
        _;
    }

    modifier bountyExists(uint256 bountyId) {
        require(bounties[bountyId].owner != address(0), "bounty not found");
        _;
    }

    function createBounty(
        string calldata title,
        string calldata rubric,
        uint256 deadline,
        uint256 revealDeadline
    ) external payable returns (uint256 bountyId) {
        require(msg.value > 0, "reward required");
        require(deadline > block.timestamp, "deadline in past");
        require(revealDeadline > deadline, "reveal must follow deadline");

        bountyId = nextBountyId++;

        Bounty storage bounty = bounties[bountyId];

        bounty.owner = msg.sender;
        bounty.title = title;
        bounty.rubric = rubric;
        bounty.reward = msg.value;
        bounty.deadline = deadline;
        bounty.revealDeadline = revealDeadline;
        bounty.winnerIndex = type(uint256).max;

        emit BountyCreated(
            bountyId,
            msg.sender,
            title,
            msg.value,
            deadline,
            revealDeadline
        );
    }

    /// Commit phase: store only a hash. The plaintext answer never touches the
    /// chain here, so nobody can read and copy it before the deadline.
    /// commitment = keccak256(abi.encode(answer, salt, msg.sender, bountyId)).
    function submitCommitment(
        uint256 bountyId,
        bytes32 commitment
    ) external bountyExists(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        require(block.timestamp < bounty.deadline, "commit phase over");
        require(commitment != bytes32(0), "empty commitment");

        // Count each participant once; re-committing before the deadline is
        // allowed and overwrites the previous hash without consuming a slot.
        if (commitmentOf[bountyId][msg.sender] == bytes32(0)) {
            require(
                bounty.commitmentCount < MAX_SUBMISSIONS,
                "too many submissions"
            );
            bounty.commitmentCount++;
        }

        commitmentOf[bountyId][msg.sender] = commitment;

        emit CommitmentSubmitted(bountyId, msg.sender, commitment);
    }

    /// Reveal phase: prove the earlier commitment and publish the plaintext.
    /// Binding the hash to msg.sender means a copied commitment is worthless,
    /// and the commit phase is already closed so a copied plaintext is too.
    function revealAnswer(
        uint256 bountyId,
        string calldata answer,
        bytes32 salt
    ) external bountyExists(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        require(block.timestamp >= bounty.deadline, "reveal not open");
        require(block.timestamp < bounty.revealDeadline, "reveal phase over");
        require(bytes(answer).length <= MAX_ANSWER_LENGTH, "answer too long");

        bytes32 commitment = commitmentOf[bountyId][msg.sender];
        require(commitment != bytes32(0), "nothing to reveal");
        require(
            keccak256(abi.encode(answer, salt, msg.sender, bountyId)) ==
                commitment,
            "commitment mismatch"
        );

        // Clear the commitment so the same entry cannot be revealed twice.
        commitmentOf[bountyId][msg.sender] = bytes32(0);

        bounty.submissions.push(
            Submission({submitter: msg.sender, answer: answer})
        );

        emit AnswerRevealed(
            bountyId,
            bounty.submissions.length - 1,
            msg.sender
        );
    }

    function judgeAll(
        uint256 bountyId,
        bytes calldata llmInput
    ) external bountyExists(bountyId) onlyOwner(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        require(
            block.timestamp >= bounty.revealDeadline,
            "reveal phase not over"
        );
        require(!bounty.judged, "already judged");
        require(!bounty.finalized, "already finalized");
        require(bounty.submissions.length > 0, "no submissions");

        bytes memory output = _executePrecompile(
            LLM_INFERENCE_PRECOMPILE,
            llmInput
        );

        (
            bool hasError,
            bytes memory completionData,
            ,
            string memory errorMessage,

        ) = abi.decode(output, (bool, bytes, bytes, string, ConvoHistory));

        require(!hasError, errorMessage);

        bounty.judged = true;
        bounty.aiReview = completionData;

        emit AllAnswersJudged(bountyId, completionData);
    }

    function finalizeWinner(
        uint256 bountyId,
        uint256 winnerIndex
    ) external bountyExists(bountyId) onlyOwner(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        require(bounty.judged, "not judged yet");
        require(!bounty.finalized, "already finalized");
        require(winnerIndex < bounty.submissions.length, "invalid index");

        bounty.finalized = true;
        bounty.winnerIndex = winnerIndex;

        address winner = bounty.submissions[winnerIndex].submitter;
        uint256 reward = bounty.reward;
        bounty.reward = 0;

        (bool ok, ) = payable(winner).call{value: reward}("");
        require(ok, "payment failed");

        emit WinnerFinalized(bountyId, winnerIndex, winner, reward);
    }

    function getBounty(
        uint256 bountyId
    )
        external
        view
        bountyExists(bountyId)
        returns (
            address owner,
            string memory title,
            string memory rubric,
            uint256 reward,
            uint256 deadline,
            uint256 revealDeadline,
            bool judged,
            bool finalized,
            uint256 submissionCount,
            uint256 commitmentCount,
            uint256 winnerIndex,
            bytes memory aiReview
        )
    {
        Bounty storage bounty = bounties[bountyId];

        owner = bounty.owner;
        title = bounty.title;
        rubric = bounty.rubric;
        reward = bounty.reward;
        deadline = bounty.deadline;
        revealDeadline = bounty.revealDeadline;
        judged = bounty.judged;
        finalized = bounty.finalized;
        submissionCount = bounty.submissions.length;
        commitmentCount = bounty.commitmentCount;
        winnerIndex = bounty.winnerIndex;
        aiReview = bounty.aiReview;
    }

    function getSubmission(
        uint256 bountyId,
        uint256 index
    )
        external
        view
        bountyExists(bountyId)
        returns (address submitter, string memory answer)
    {
        Bounty storage bounty = bounties[bountyId];

        require(index < bounty.submissions.length, "invalid index");

        Submission storage submission = bounty.submissions[index];

        return (submission.submitter, submission.answer);
    }
}
