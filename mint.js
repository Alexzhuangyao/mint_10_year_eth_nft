const { ethers } = require('ethers');

// 合约地址
const CONTRACT_ADDRESS = '0x26d85a13212433fe6a8381969c2b0db390a0b0ae';

// 以太坊RPC节点URL - 直接在这里填写
const RPC_URL = "https://eth.llamarpc.com"; 


// 多钱包配置 - 直接在这里添加私钥
const WALLET_PRIVATE_KEYS = [
  // 这里填入你的私钥，每个私钥对应一个钱包
  //   "0x你的私钥1",  // 钱包1
    //   "0x你的私钥2",  // 钱包2
    //   "0x你的私钥3",  // 钱包3
//   // 可以添加更多私钥...
];

// Gas配置
const GAS_LIMIT = 150000;
// 是否在mint失败后自动尝试下一个钱包
const AUTO_CONTINUE_ON_FAILURE = true;
// 两次mint操作之间的等待时间(毫秒)
const DELAY_BETWEEN_MINTS = 2000;

// 合约ABI
const CONTRACT_ABI = [
  {
    "inputs": [],
    "name": "mint",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"internalType":"address","name":"","type":"address"}],
    "name": "hasMinted",
    "outputs": [{"internalType":"bool","name":"","type":"bool"}],
    "stateMutability": "view",
    "type": "function"
  }
];

/**
 * 获取当前ETH主网的gas价格
 */
async function getGasPrice(provider) {
  try {
    // 获取当前gas价格
    const feeData = await provider.getFeeData();
    console.log('当前Gas价格 (maxFeePerGas):', ethers.formatUnits(feeData.maxFeePerGas, 'gwei'), 'gwei');
    console.log('当前Gas价格 (maxPriorityFeePerGas):', ethers.formatUnits(feeData.maxPriorityFeePerGas, 'gwei'), 'gwei');
    console.log('当前Gas价格 (gasPrice):', ethers.formatUnits(feeData.gasPrice, 'gwei'), 'gwei');
    
    return feeData;
  } catch (error) {
    console.error('获取Gas价格失败:', error);
    throw error;
  }
}

/**
 * 检查是否可以铸造NFT
 */
async function checkMintingStatus(contract, wallet) {
  // 检查用户是否已经铸造过NFT
  const walletAddress = await wallet.getAddress();
  const hasMinted = await contract.hasMinted(walletAddress);
  console.log('钱包是否已铸造过:', hasMinted);
  
  if (hasMinted) {
    console.log('该钱包地址已经铸造过NFT，每个地址只能铸造一次。');
    return false;
  }
  
  return true;
}

/**
 * 等待指定的毫秒数
 * @param {number} ms - 等待的毫秒数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 使用特定钱包执行NFT铸造
 */
async function mintWithWallet(privateKey, provider, index) {
  try {
    const wallet = new ethers.Wallet(privateKey, provider);
    const walletAddress = await wallet.getAddress();
    
    console.log(`\n======== 钱包 ${index + 1} ========`);
    console.log('使用钱包地址:', walletAddress);
    
    // 连接到合约
    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
    
    // 检查余额
    const balance = await provider.getBalance(walletAddress);
    console.log('钱包ETH余额:', ethers.formatEther(balance), 'ETH');
    
    // 检查是否有足够余额支付gas
    const minBalance = ethers.parseEther("0.005"); // 假设0.005 ETH作为最低要求
    if (ethers.getBigInt(balance) < ethers.getBigInt(minBalance)) {
      console.error('错误: 钱包余额过低，可能无法支付gas费');
      return { success: false, reason: 'INSUFFICIENT_BALANCE' };
    }
    
    // 检查铸造状态
    const canMint = await checkMintingStatus(contract, wallet);
    if (!canMint) {
      return { success: false, reason: 'ALREADY_MINTED' };
    }
    
    // 获取当前gas价格
    const feeData = await getGasPrice(provider);
    
    // 准备铸造交易
    console.log('准备发送mint交易...');
    
    // 设置交易参数
    const txParams = {
      gasLimit: GAS_LIMIT,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
    };
    
    // 发送交易
    const tx = await contract.mint(txParams);
    console.log('交易已发送，交易哈希:', tx.hash);
    console.log(`查看交易: https://etherscan.io/tx/${tx.hash}`);
    console.log('等待交易确认...');
    
    // 等待交易确认
    const receipt = await tx.wait();
    console.log('交易已确认，区块哈希:', receipt.blockHash);
    console.log('Gas使用量:', receipt.gasUsed.toString());
    console.log('NFT铸造成功！');
    
    return { success: true, txHash: tx.hash };
    
  } catch (error) {
    console.error('铸造过程出错:', error);
    // 检查错误类型并提供更详细的信息
    if (error.reason) {
      console.error('错误原因:', error.reason);
    }
    if (error.code === 'INSUFFICIENT_FUNDS') {
      console.error('错误: 钱包余额不足，无法支付gas费');
    }
    return { success: false, reason: error.message || 'UNKNOWN_ERROR' };
  }
}

/**
 * 执行批量NFT铸造，使用所有配置的钱包
 */
async function batchMintNFT() {
  if (!WALLET_PRIVATE_KEYS || WALLET_PRIVATE_KEYS.length === 0) {
    console.error('错误: 未配置任何钱包私钥');
    return;
  }
  
  // 初始化以太坊提供者
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  console.log(`开始批量铸造，共有 ${WALLET_PRIVATE_KEYS.length} 个钱包配置`);
  const results = [];
  
  for (let i = 0; i < WALLET_PRIVATE_KEYS.length; i++) {
    const privateKey = WALLET_PRIVATE_KEYS[i];
    if (!privateKey) {
      console.log(`跳过钱包 ${i + 1}: 私钥为空`);
      continue;
    }
    
    // 使用当前钱包铸造
    const result = await mintWithWallet(privateKey, provider, i);
    results.push({ walletIndex: i, ...result });
    
    // 如果铸造失败并且配置了不自动继续，则停止
    if (!result.success && !AUTO_CONTINUE_ON_FAILURE) {
      console.log('铸造失败，已停止后续操作。');
      break;
    }
    
    // 如果还有下一个钱包，等待一段时间再继续
    if (i < WALLET_PRIVATE_KEYS.length - 1) {
      console.log(`等待 ${DELAY_BETWEEN_MINTS / 1000} 秒后继续下一个钱包...`);
      await sleep(DELAY_BETWEEN_MINTS);
    }
  }
  
  // 汇总结果
  console.log('\n======== 铸造结果汇总 ========');
  const successful = results.filter(r => r.success).length;
  console.log(`成功: ${successful} / ${results.length}`);
  
  if (successful > 0) {
    console.log('\n成功的交易:');
    results.filter(r => r.success).forEach((r, idx) => {
      console.log(`${idx + 1}. 钱包 ${r.walletIndex + 1}: https://etherscan.io/tx/${r.txHash}`);
    });
  }
  
  if (successful < results.length) {
    console.log('\n失败的钱包:');
    results.filter(r => !r.success).forEach((r, idx) => {
      console.log(`${idx + 1}. 钱包 ${r.walletIndex + 1}: ${r.reason}`);
    });
  }
}

// 执行批量铸造
batchMintNFT().catch(console.error);
