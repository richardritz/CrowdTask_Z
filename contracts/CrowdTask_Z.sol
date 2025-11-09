pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract CrowdTaskZ is ZamaEthereumConfig {
    struct Task {
        string title;
        euint32 encryptedData;
        uint256 rewardAmount;
        uint256 deadline;
        address requester;
        bool isActive;
        bool isCompleted;
    }

    struct Worker {
        address workerAddress;
        uint256 reputation;
        uint256 completedTasks;
    }

    mapping(string => Task) public tasks;
    mapping(address => Worker) public workers;
    mapping(string => address) public taskAssignments;

    string[] public taskIds;
    address[] public workerAddresses;

    event TaskCreated(string indexed taskId, address indexed requester);
    event TaskAssigned(string indexed taskId, address indexed worker);
    event TaskCompleted(string indexed taskId, address indexed worker);

    constructor() ZamaEthereumConfig() {
    }

    function createTask(
        string calldata taskId,
        string calldata title,
        externalEuint32 encryptedData,
        bytes calldata inputProof,
        uint256 rewardAmount,
        uint256 deadline
    ) external {
        require(bytes(tasks[taskId].title).length == 0, "Task already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedData, inputProof)), "Invalid encrypted input");

        tasks[taskId] = Task({
            title: title,
            encryptedData: FHE.fromExternal(encryptedData, inputProof),
            rewardAmount: rewardAmount,
            deadline: deadline,
            requester: msg.sender,
            isActive: true,
            isCompleted: false
        });

        FHE.allowThis(tasks[taskId].encryptedData);
        FHE.makePubliclyDecryptable(tasks[taskId].encryptedData);

        taskIds.push(taskId);
        emit TaskCreated(taskId, msg.sender);
    }

    function registerWorker() external {
        require(workers[msg.sender].workerAddress == address(0), "Worker already registered");
        workers[msg.sender] = Worker({
            workerAddress: msg.sender,
            reputation: 0,
            completedTasks: 0
        });
        workerAddresses.push(msg.sender);
    }

    function assignTask(string calldata taskId) external {
        require(bytes(tasks[taskId].title).length > 0, "Task does not exist");
        require(tasks[taskId].isActive, "Task is not active");
        require(taskAssignments[taskId] == address(0), "Task already assigned");
        require(workers[msg.sender].workerAddress != address(0), "Worker not registered");

        taskAssignments[taskId] = msg.sender;
        emit TaskAssigned(taskId, msg.sender);
    }

    function submitTaskResult(
        string calldata taskId,
        bytes memory abiEncodedResult,
        bytes memory computationProof
    ) external {
        require(bytes(tasks[taskId].title).length > 0, "Task does not exist");
        require(taskAssignments[taskId] == msg.sender, "Not assigned to this worker");
        require(!tasks[taskId].isCompleted, "Task already completed");
        require(block.timestamp <= tasks[taskId].deadline, "Task deadline passed");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(tasks[taskId].encryptedData);

        FHE.checkSignatures(cts, abiEncodedResult, computationProof);

        tasks[taskId].isCompleted = true;
        tasks[taskId].isActive = false;
        workers[msg.sender].completedTasks++;
        workers[msg.sender].reputation += 10;

        emit TaskCompleted(taskId, msg.sender);
    }

    function getTask(string calldata taskId) external view returns (
        string memory title,
        uint256 rewardAmount,
        uint256 deadline,
        address requester,
        bool isActive,
        bool isCompleted
    ) {
        require(bytes(tasks[taskId].title).length > 0, "Task does not exist");
        Task storage task = tasks[taskId];
        return (
            task.title,
            task.rewardAmount,
            task.deadline,
            task.requester,
            task.isActive,
            task.isCompleted
        );
    }

    function getWorker(address workerAddress) external view returns (
        uint256 reputation,
        uint256 completedTasks
    ) {
        require(workers[workerAddress].workerAddress != address(0), "Worker not registered");
        Worker storage worker = workers[workerAddress];
        return (worker.reputation, worker.completedTasks);
    }

    function getAllTaskIds() external view returns (string[] memory) {
        return taskIds;
    }

    function getAllWorkers() external view returns (address[] memory) {
        return workerAddresses;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

