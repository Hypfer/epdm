class Mutex {
    constructor() {
        this._lock = Promise.resolve();
    }

    async withLock(operation) {
        const unlock = await this._lock;
        if (unlock) unlock();

        let unlockNext;
        this._lock = new Promise(resolve => {
            unlockNext = resolve;
        });

        try {
            return await operation();
        } finally {
            unlockNext();
        }
    }
}

module.exports = Mutex;