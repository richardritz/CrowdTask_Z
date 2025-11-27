import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface TaskData {
  id: string;
  name: string;
  description: string;
  reward: number;
  difficulty: number;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
  publicValue1: number;
  publicValue2: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newTaskData, setNewTaskData] = useState({ name: "", description: "", reward: "", difficulty: "" });
  const [selectedTask, setSelectedTask] = useState<TaskData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterDifficulty, setFilterDifficulty] = useState("all");
  const [stats, setStats] = useState({ total: 0, verified: 0, averageReward: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const tasksList: TaskData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          tasksList.push({
            id: businessId,
            name: businessData.name,
            description: businessData.description,
            reward: Number(businessData.publicValue1) || 0,
            difficulty: Number(businessData.publicValue2) || 1,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setTasks(tasksList);
      updateStats(tasksList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (tasksList: TaskData[]) => {
    const total = tasksList.length;
    const verified = tasksList.filter(t => t.isVerified).length;
    const averageReward = total > 0 ? tasksList.reduce((sum, t) => sum + t.reward, 0) / total : 0;
    
    setStats({ total, verified, averageReward });
  };

  const createTask = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingTask(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted task..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const rewardValue = parseInt(newTaskData.reward) || 0;
      const businessId = `task-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, rewardValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newTaskData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        rewardValue,
        parseInt(newTaskData.difficulty) || 1,
        newTaskData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Task created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewTaskData({ name: "", description: "", reward: "", difficulty: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingTask(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract call failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredTasks = tasks.filter(task => {
    const matchesSearch = task.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         task.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesDifficulty = filterDifficulty === "all" || task.difficulty.toString() === filterDifficulty;
    return matchesSearch && matchesDifficulty;
  });

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>CrowdTask_Z 🛡️</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🛡️</div>
            <h2>Connect to Confidential Crowdsourcing</h2>
            <p>Join our privacy-preserving platform where tasks are executed with fully homomorphic encryption</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to access encrypted tasks</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will initialize for secure computations</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start working on encrypted data tasks</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your data with homomorphic encryption</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted task platform...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>CrowdTask_Z 🛡️</h1>
          <span className="tagline">Privacy-Preserving Crowdsourcing</span>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="status-btn">
            Check Status
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Task
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-card">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Tasks</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">Verified</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.averageReward.toFixed(1)}</div>
            <div className="stat-label">Avg Reward</div>
          </div>
        </div>

        <div className="search-filters">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search tasks..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <select 
            value={filterDifficulty} 
            onChange={(e) => setFilterDifficulty(e.target.value)}
            className="filter-select"
          >
            <option value="all">All Difficulties</option>
            <option value="1">Easy</option>
            <option value="2">Medium</option>
            <option value="3">Hard</option>
          </select>
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="tasks-grid">
          {filteredTasks.length === 0 ? (
            <div className="no-tasks">
              <p>No tasks found matching your criteria</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Create First Task
              </button>
            </div>
          ) : (
            filteredTasks.map((task) => (
              <TaskCard 
                key={task.id} 
                task={task} 
                onSelect={setSelectedTask}
                onDecrypt={decryptData}
                isDecrypting={fheIsDecrypting}
              />
            ))
          )}
        </div>

        <div className="faq-section">
          <h3>FHE Crowdsourcing FAQ</h3>
          <div className="faq-item">
            <strong>How does FHE protect my data?</strong>
            <p>Fully Homomorphic Encryption allows computations on encrypted data without decryption, ensuring privacy throughout the task execution.</p>
          </div>
          <div className="faq-item">
            <strong>What types of tasks are supported?</strong>
            <p>Currently supporting integer-based data labeling and analysis tasks that can be processed with homomorphic operations.</p>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <CreateTaskModal 
          onSubmit={createTask} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingTask} 
          taskData={newTaskData} 
          setTaskData={setNewTaskData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedTask && (
        <TaskDetailModal 
          task={selectedTask} 
          onClose={() => setSelectedTask(null)} 
          onDecrypt={decryptData}
          isDecrypting={fheIsDecrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const TaskCard: React.FC<{
  task: TaskData;
  onSelect: (task: TaskData) => void;
  onDecrypt: (id: string) => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ task, onSelect, onDecrypt, isDecrypting }) => {
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleDecrypt = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const result = await onDecrypt(task.id);
    if (result !== null) {
      setLocalDecrypted(result);
    }
  };

  const getDifficultyColor = (difficulty: number) => {
    switch(difficulty) {
      case 1: return "#4CAF50";
      case 2: return "#FF9800";
      case 3: return "#F44336";
      default: return "#666";
    }
  };

  return (
    <div className="task-card" onClick={() => onSelect(task)}>
      <div className="task-header">
        <h3>{task.name}</h3>
        <span 
          className="difficulty-badge"
          style={{ backgroundColor: getDifficultyColor(task.difficulty) }}
        >
          {["Easy", "Medium", "Hard"][task.difficulty - 1] || "Unknown"}
        </span>
      </div>
      
      <p className="task-description">{task.description}</p>
      
      <div className="task-meta">
        <div className="meta-item">
          <span>Reward:</span>
          <strong>{task.reward} tokens</strong>
        </div>
        <div className="meta-item">
          <span>Creator:</span>
          <span>{task.creator.substring(0, 6)}...{task.creator.substring(38)}</span>
        </div>
      </div>
      
      <div className="task-data">
        <div className="data-value">
          {task.isVerified ? 
            `Decrypted: ${task.decryptedValue}` : 
            localDecrypted !== null ? 
            `Local: ${localDecrypted}` : 
            "🔒 Encrypted"
          }
        </div>
        <button 
          className={`decrypt-btn ${(task.isVerified || localDecrypted !== null) ? 'decrypted' : ''}`}
          onClick={handleDecrypt}
          disabled={isDecrypting}
        >
          {isDecrypting ? "🔓..." : task.isVerified ? "✅ Verified" : localDecrypted !== null ? "🔄 Verify" : "🔓 Decrypt"}
        </button>
      </div>
      
      <div className="task-footer">
        <span>{new Date(task.timestamp * 1000).toLocaleDateString()}</span>
        {task.isVerified && <span className="verified-tag">Verified</span>}
      </div>
    </div>
  );
};

const CreateTaskModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  taskData: any;
  setTaskData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, taskData, setTaskData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'reward' || name === 'difficulty') {
      const intValue = value.replace(/[^\d]/g, '');
      setTaskData({ ...taskData, [name]: intValue });
    } else {
      setTaskData({ ...taskData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-task-modal">
        <div className="modal-header">
          <h2>Create Encrypted Task</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Protection</strong>
            <p>Task reward value will be encrypted with Zama FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Task Name *</label>
            <input 
              type="text" 
              name="name" 
              value={taskData.name} 
              onChange={handleChange} 
              placeholder="Enter task name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Description *</label>
            <textarea 
              name="description" 
              value={taskData.description} 
              onChange={handleChange} 
              placeholder="Describe the task..." 
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Reward (Integer only) *</label>
            <input 
              type="number" 
              name="reward" 
              value={taskData.reward} 
              onChange={handleChange} 
              placeholder="Enter reward amount..." 
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Difficulty (1-3) *</label>
            <input 
              type="number" 
              name="difficulty" 
              value={taskData.difficulty} 
              onChange={handleChange} 
              placeholder="1=Easy, 2=Medium, 3=Hard"
              min="1"
              max="3"
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !taskData.name || !taskData.description || !taskData.reward || !taskData.difficulty} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Task"}
          </button>
        </div>
      </div>
    </div>
  );
};

const TaskDetailModal: React.FC<{
  task: TaskData;
  onClose: () => void;
  onDecrypt: (id: string) => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ task, onClose, onDecrypt, isDecrypting }) => {
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleDecrypt = async () => {
    const result = await onDecrypt(task.id);
    if (result !== null) {
      setLocalDecrypted(result);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="task-detail-modal">
        <div className="modal-header">
          <h2>Task Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="task-info">
            <div className="info-item">
              <span>Task Name:</span>
              <strong>{task.name}</strong>
            </div>
            <div className="info-item">
              <span>Description:</span>
              <p>{task.description}</p>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{task.creator}</strong>
            </div>
            <div className="info-item">
              <span>Created:</span>
              <strong>{new Date(task.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>Difficulty:</span>
              <strong>{["Easy", "Medium", "Hard"][task.difficulty - 1] || "Unknown"}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Reward Data</h3>
            <div className="data-row">
              <div className="data-label">Reward Value:</div>
              <div className="data-value">
                {task.isVerified ? 
                  `${task.decryptedValue} tokens (On-chain Verified)` : 
                  localDecrypted !== null ? 
                  `${localDecrypted} tokens (Locally Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
            </div>
            
            <button 
              className={`decrypt-btn large ${(task.isVerified || localDecrypted !== null) ? 'decrypted' : ''}`}
              onClick={handleDecrypt}
              disabled={isDecrypting}
            >
              {isDecrypting ? "Decrypting..." : task.isVerified ? "✅ Verified" : localDecrypted !== null ? "🔄 Re-verify" : "🔓 Decrypt Reward"}
            </button>
            
            <div className="fhe-explanation">
              <h4>FHE Protection Process</h4>
              <ol>
                <li>Reward value encrypted on-chain using Zama FHE</li>
                <li>Workers process tasks without accessing raw data</li>
                <li>Decryption requires proper authorization and verification</li>
                <li>Results verified on-chain for transparency</li>
              </ol>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;