import {localStorage} from "./storage";
import node_or_tools = require("node_or_tools");
import Blacklist from "./blacklist";

function getUserIds(): string[] {
	return localStorage._keys.filter(it => /^(early_)?[0-9]+$/.test(it)).map(it => it.replace(/^early_/, ""));
}

export default async function createMatches(): Promise<string[]> {
    let userlist: string[] = getUserIds();

    const blacklist = new Blacklist("./blacklist.txt");
    
    let costs: Number[][] = new Array(userlist.length);
    
    /* Assign a "noise cost" to non-blacklisted matches to ensure non-determinism in matches.
     * It must be such that even "accumulating" the maximum amount of noise, the cost is still
     * lower than matching two blacklisted users.
     */
    const noise_cost_max = 10;
    const blacklisted_cost = noise_cost_max * userlist.length + 100
    for (let i = 0; i < userlist.length; i++) {
        costs[i] = new Array(userlist.length);
        const src = userlist[i];
        for (let j = 0; j < userlist.length; j++) {
            if (i == j) {
                costs[i][j] = 10000;
                continue;
            }
            const dst = userlist[j];
            costs[i][j] = (blacklist.isBlacklisted(src, dst)) ? blacklisted_cost : (Math.random() * noise_cost_max);
        }
    }
    
    var tspSolverOpts = {
        numNodes: userlist.length,
        costs: costs
    };
    
    var TSP = new node_or_tools.TSP(tspSolverOpts);
    const firstNode = 0;
    var tspSearchOpts = {
        computeTimeLimit: 1000,
        depotNode: firstNode
    };
    return new Promise((resolve, reject) => TSP.Solve(tspSearchOpts, function (err, solution: number[]) {
        if (err) {
            reject(err);
            return;
        }
        const chain = [firstNode, ...solution].map(index => userlist[index]);
        resolve(chain);
    }));
}