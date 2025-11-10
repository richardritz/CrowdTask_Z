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
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  decryptedValue: number;
  isVerified: boolean;
  status: string;
  reward: number;
  workerCount: number;
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
  const [newTaskData, setNewTaskData] = useState({ 
    name: "", 
    description: "", 
    reward: "",
    dataValue: "",
    workerCount: "" 
  });
  const [selectedTask, setSelectedTask] = useState<TaskData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [userHistory, setUserHistory] = useState<TaskData[]>([]);
  const [showStats, setShowStats] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

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
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            isVerified: businessData.isVerified,
            status: businessData.isVerified ? "completed" : "active",
            reward: Number(businessData.publicValue1) || 0,
            workerCount: Number(businessData.publicValue2) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setTasks(tasksList);
      if (address) {
        setUserHistory(tasksList.filter(task => task.creator.toLowerCase() === address.toLowerCase()));
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
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
      
      const dataValue = parseInt(newTaskData.dataValue) || 0;
      const businessId = `task-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, dataValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newTaskData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newTaskData.reward) || 0,
        parseInt(newTaskData.workerCount) || 0,
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
      setNewTaskData({ name: "", description: "", reward: "", dataValue: "", workerCount: "" });
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
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
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
      const contract = await getContractWithSigner();
      if (!contract) return;
      
      const tx = await contract.isAvailable();
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "isAvailable called successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Call failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredTasks = tasks.filter(task => {
    const matchesSearch = task.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          task.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === "all" || task.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const stats = {
    totalTasks: tasks.length,
    activeTasks: tasks.filter(t => t.status === "active").length,
    completedTasks: tasks.filter(t => t.status === "completed").length,
    totalReward: tasks.reduce((sum, t) => sum + t.reward, 0),
    uniqueCreators: new Set(tasks.map(t => t.creator)).size
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Confidential Crowdsourcing 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to access encrypted crowdsourcing platform</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet using the button above</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will automatically initialize</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start creating and working on encrypted tasks</p>
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
        <p className="loading-note">This may take a few moments</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted crowdsourcing platform...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Confidential Crowdsourcing 🔐</h1>
          <p>FHE-Protected Task Platform</p>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="test-btn">Test FHE</button>
          <button onClick={() => setShowStats(!showStats)} className="stats-btn">
            {showStats ? "Hide Stats" : "Show Stats"}
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Task
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      {showStats && (
        <div className="stats-panel">
          <div className="stat-item">
            <span className="stat-value">{stats.totalTasks}</span>
            <span className="stat-label">Total Tasks</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.activeTasks}</span>
            <span className="stat-label">Active</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.completedTasks}</span>
            <span className="stat-label">Completed</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.totalReward}</span>
            <span className="stat-label">Total Reward</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.uniqueCreators}</span>
            <span className="stat-label">Creators</span>
          </div>
        </div>
      )}
      
      <div className="main-content">
        <div className="controls-panel">
          <div className="search-section">
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
          
          <div className="filter-section">
            <select 
              value={filterStatus} 
              onChange={(e) => setFilterStatus(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Tasks</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          
          <div className="action-section">
            <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
        
        <div className="tasks-grid">
          {filteredTasks.length === 0 ? (
            <div className="no-tasks">
              <p>No tasks found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Create First Task
              </button>
            </div>
          ) : (
            filteredTasks.map((task, index) => (
              <div 
                className={`task-card ${task.status} ${selectedTask?.id === task.id ? "selected" : ""}`}
                key={index}
                onClick={() => setSelectedTask(task)}
              >
                <div className="task-header">
                  <h3 className="task-title">{task.name}</h3>
                  <span className={`status-badge ${task.status}`}>{task.status}</span>
                </div>
                <p className="task-description">{task.description}</p>
                <div className="task-meta">
                  <span className="reward">Reward: {task.reward} tokens</span>
                  <span className="workers">Workers: {task.workerCount}</span>
                </div>
                <div className="task-footer">
                  <span className="creator">By: {task.creator.substring(0, 6)}...{task.creator.substring(38)}</span>
                  <span className="date">{new Date(task.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                {task.isVerified && (
                  <div className="verified-badge">✅ FHE Verified</div>
                )}
              </div>
            ))
          )}
        </div>
        
        {userHistory.length > 0 && (
          <div className="history-section">
            <h3>Your Task History</h3>
            <div className="history-list">
              {userHistory.slice(0, 3).map((task, index) => (
                <div className="history-item" key={index}>
                  <span>{task.name}</span>
                  <span className={`status ${task.status}`}>{task.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {showCreateModal && (
        <ModalCreateTask 
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
          decryptData={() => decryptData(selectedTask.id)}
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

const ModalCreateTask: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  taskData: any;
  setTaskData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, taskData, setTaskData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'dataValue' || name === 'reward' || name === 'workerCount') {
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
            <p>Task data will be encrypted with Zama FHE (Integer only)</p>
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
            <label>Data Value (Integer, FHE Encrypted) *</label>
            <input 
              type="number" 
              name="dataValue" 
              value={taskData.dataValue} 
              onChange={handleChange} 
              placeholder="Enter data value..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Reward (Tokens) *</label>
            <input 
              type="number" 
              name="reward" 
              value={taskData.reward} 
              onChange={handleChange} 
              placeholder="Enter reward amount..." 
              step="1"
              min="0"
            />
          </div>
          
          <div className="form-group">
            <label>Worker Count *</label>
            <input 
              type="number" 
              name="workerCount" 
              value={taskData.workerCount} 
              onChange={handleChange} 
              placeholder="Enter worker count..." 
              step="1"
              min="1"
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !taskData.name || !taskData.description || !taskData.dataValue || !taskData.reward || !taskData.workerCount} 
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
  decryptData: () => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ task, onClose, decryptData, isDecrypting }) => {
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (task.isVerified) return;
    const value = await decryptData();
    setDecryptedValue(value);
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
            <div className="info-row">
              <span>Task Name:</span>
              <strong>{task.name}</strong>
            </div>
            <div className="info-row">
              <span>Creator:</span>
              <strong>{task.creator.substring(0, 6)}...{task.creator.substring(38)}</strong>
            </div>
            <div className="info-row">
              <span>Created:</span>
              <strong>{new Date(task.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-row">
              <span>Reward:</span>
              <strong>{task.reward} tokens</strong>
            </div>
            <div className="info-row">
              <span>Workers Needed:</span>
              <strong>{task.workerCount}</strong>
            </div>
            <div className="info-row">
              <span>Status:</span>
              <strong className={`status ${task.status}`}>{task.status}</strong>
            </div>
          </div>
          
          <div className="description-section">
            <h3>Description</h3>
            <p>{task.description}</p>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Data</h3>
            <div className="data-row">
              <div className="data-label">Encrypted Value:</div>
              <div className="data-value">
                {task.isVerified ? 
                  `${task.decryptedValue} (Verified)` : 
                  decryptedValue !== null ? 
                  `${decryptedValue} (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(task.isVerified || decryptedValue !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || task.isVerified}
              >
                {isDecrypting ? "Decrypting..." : 
                 task.isVerified ? "✅ Verified" : 
                 decryptedValue !== null ? "🔓 Decrypted" : 
                 "🔓 Decrypt Data"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Protected Data</strong>
                <p>Data is encrypted on-chain using Zama FHE technology</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!task.isVerified && (
            <button onClick={handleDecrypt} disabled={isDecrypting} className="verify-btn">
              Verify on-chain
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

