export class ProgressIndicator {
    steps = [
        { name: 'Our MCP', status: 'pending' },
        { name: 'Wrangler', status: 'pending' },
        { name: 'Target MCP', status: 'pending' },
    ];
    updateStep(index, status) {
        if (index >= 0 && index < this.steps.length) {
            this.steps[index].status = status;
            this.render();
        }
    }
    render() {
        process.stdout.write(`\r${' '.repeat(80)}\r`);
        const parts = [];
        for (let i = 0; i < this.steps.length; i++) {
            const step = this.steps[i];
            if (step.status === 'pending') {
                parts.push(step.name);
            }
            else {
                let icon = '';
                if (step.status === 'running') {
                    icon = '⟳';
                }
                else if (step.status === 'success') {
                    icon = '✓';
                }
                else if (step.status === 'failed') {
                    icon = '✗';
                }
                parts.push(`${icon} ${step.name}`);
            }
            if (i < this.steps.length - 1) {
                parts.push('→');
            }
        }
        process.stdout.write(parts.join(' '));
    }
    clear() {
        process.stdout.write(`\r${' '.repeat(80)}\r`);
    }
    showFinal(failedAt) {
        this.clear();
        const parts = [];
        for (let i = 0; i < this.steps.length; i++) {
            const step = this.steps[i];
            let icon = '';
            let color = '';
            if (step.status === 'success') {
                icon = '✓';
                color = '\x1b[32m';
            }
            else if (step.status === 'failed' ||
                (failedAt !== undefined && i === failedAt)) {
                icon = '✗';
                color = '\x1b[31m';
            }
            else if (step.status === 'running') {
                icon = '⟳';
                color = '\x1b[33m';
            }
            if (icon) {
                parts.push(`${color}${icon}\x1b[0m ${step.name}`);
            }
            else {
                parts.push(step.name);
            }
            if (i < this.steps.length - 1) {
                const arrowColor = failedAt !== undefined && i >= failedAt ? '\x1b[31m' : '';
                parts.push(`${arrowColor}→\x1b[0m`);
            }
        }
        console.log(parts.join(' '));
    }
    reset() {
        this.steps.forEach((step) => {
            step.status = 'pending';
        });
    }
}
//# sourceMappingURL=progress-indicator.js.map