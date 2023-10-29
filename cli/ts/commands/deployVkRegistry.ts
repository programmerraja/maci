import { resetContractAddresses, storeContractAddress } from "../utils/storage"
import { deployVkRegistry } from "maci-contracts"
import { renameSync } from "fs"
import { contractAddressesStore, oldContractAddressesStore } from "../utils/constants"
import { logGreen, success } from "../utils/theme"
import { banner } from "../utils/banner"

/**
 * Deploy the vkRegistry contract
 * @param quiet - whether to print the contract address
 */
export const deployVkRegistryContract = async (
    { quiet }
) => {
    banner()
    // assume that the vkRegistry contract is the first one to be deployed
    renameSync(contractAddressesStore, oldContractAddressesStore)
    resetContractAddresses()

    const vkRegistry = await deployVkRegistry(true)
    await vkRegistry.deployTransaction.wait()
    storeContractAddress("VkRegistry", vkRegistry.address)

    if (!quiet) logGreen(success(`VkRegistry deployed at: ${vkRegistry.address}`))
} 
