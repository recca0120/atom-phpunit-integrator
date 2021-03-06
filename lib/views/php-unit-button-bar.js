/** @babel */
/** @jsx etch.dom */
/* global atom */

import etch from 'etch'

const icons = {
	cancelAll: 'icon fa-lg fa fa-cancel-all',
	runSuite: 'icon fa-lg fa fa-run-all',
	runSelected: 'icon fa-lg fa fa-run-select',
	clearAll: 'icon fa-lg fa fa-clear-all',
	collapseAll: 'icon fa-lg fa fa-collapse-all',
	expandAll: 'icon fa-lg fa fa-expand-all',
	sortAsc: 'icon fa-lg fa fa-sort-asc',
	sortDesc: 'icon fa-lg fa fa-sort-desc',

	toggleTerminal: 'icon fa-lg fa fa-terminal',
	toggleCoverage: 'icon fa-lg fa fa-coverage',

	filterPassed: 'icon fa-lg fa fa-passed php-test-passed',
	filterError: 'icon fa-lg fa fa-error php-test-error',
	filterWarning: 'icon fa-lg fa fa-warning php-test-warning',
	filterFailure: 'icon fa-lg fa fa-failure php-test-failure',
	filterSkipped: 'icon fa-lg fa fa-skipped php-test-skipped',
}

const availableButtons = [
	'cancelAll',
	'runSuite',
	'runSelected',
	'clearAll',
	'collapseAll',
	'expandAll',
	'sortAsc',
	'sortDesc',
	'toggleTerminal',
	'toggleCoverage',
	'filterPassed',
	'filterError',
	'filterWarning',
	'filterFailure',
	'filterSkipped'
]

const filterButtons = {
	passed: 'filterPassed',
	error: 'filterError',
	warning: 'filterWarning',
	failure: 'filterFailure',
	skipped: 'filterSkipped'
}

const filterTitles = {
	passed: 'Filter Passed',
	error: 'Filter Errors',
	warning: 'Filter Warnings',
	failure: 'Filter Failures',
	skipped: 'Filter Skipped'
}

export default class PhpUnitButtonBar
{
	constructor (properties = {}) {
		this.filterStates = properties.filterStates || []
		this.clickhandler = properties.on.click

		delete properties.on.click

		this.updateButtonOptions(properties)

		etch.initialize(this)
	}

	update (properties = {}) {
		this.filterStates = properties.filterStates || []

		this.updateButtonOptions(properties)

		return etch.update(this)
	}

	getFilterStates () {
		const states = []

		for (const state of this.filterStates) {
			const buttonKey = filterButtons[state]
			const buttonOptions = this[buttonKey + 'Options']

			if (buttonOptions.className.includes('active')) {
				states.push(state)
			}
		}

		return states
	}

	updateButtonOptions (properties) {
		for (let buttonName of availableButtons) {
			const local = buttonName + 'Options'
			const props = Object.assign({}, properties[buttonName])

			this[local] = {
				key: buttonName,
				ref: buttonName,
				disabled: !!props.disabled,
				style: props.hidden ? {display: 'none'} : {},
				className: icons[buttonName] + (props.active ? ' active' : ''),
			}
		}
	}

	/**
	 * Registers a function to call during the next refresh cycle
	 *
	 * @private
	 * @param  {Function} cb - The function to call
	 *
	 * @return {Promise}     - Resolves when the update completes
	 */
	scheduleUpdate (cb) {
		atom.views.updateDocument(cb)

		return atom.views.getNextUpdatePromise()
	}

	toggleButtonState (which) {
		const key = which + 'Options'

		this.scheduleUpdate(() => {
			const button = this.refs[which]
			const turnOn = !button.classList.contains('active')

			if (turnOn) {
				button.classList.add('active')
			} else {
				button.classList.remove('active')
			}

			this[key].className = button.className

			this.clickhandler({
				button: which,
				active: turnOn,
				states: this.getFilterStates()
			})
		})
	}

	onClickButton (which) {
		this.clickhandler({
			button: which
		})
	}

	render () {
		let filters = []

		for (const state of Object.keys(filterButtons)) {
			if (-1 !== this.filterStates.indexOf(state)) {
				const buttonKey = filterButtons[state] + 'Options'

				filters.push(
					<li>
						<button { ...this[buttonKey] }
							title={ filterTitles[state] }
							onClick={ this.toggleButtonState.bind(this, filterButtons[state]) }
						/>
					</li>
				)
			}
		}

		if (filters.length <= 1) {
			filters = []
		} else {
			filters.unshift(<li key="div-filter"><divider/></li>)
		}

		return (
			<ul className="php-unit-button-bar">
				<li>
					<button { ...this.cancelAllOptions }
						title="Cancel All Tests"
						onClick={this.onClickButton.bind(this, 'cancelAll')}
					/>
				</li>
				<li>
					<button { ...this.runSuiteOptions }
						title="Run Suite"
						onClick={this.onClickButton.bind(this, 'runSuite')}
					/>
				</li>
				<li>
					<button { ...this.runSelectedOptions }
						title="Run Selected"
						onClick={this.onClickButton.bind(this, 'runSelected')}
					/>
				</li>
				<li>
					<button { ...this.clearAllOptions }
						title="Clear All"
						onClick={this.onClickButton.bind(this, 'clearAll')}
					/>
				</li>
				<li>
					<button { ...this.expandAllOptions }
						title="Expand All"
						onClick={this.onClickButton.bind(this, 'expandAll')}
					/>
				</li>
				<li>
					<button { ...this.collapseAllOptions }
						title="Collapse All"
						onClick={this.onClickButton.bind(this, 'collapseAll')}
					/>
				</li>
				<li>
					<button { ...this.sortAscOptions }
						title="Sort Ascending"
						onClick={this.onClickButton.bind(this, 'sortAsc')}
					/>
				</li>
				<li>
					<button { ...this.sortDescOptions }
						title="Sort Descending"
						onClick={this.onClickButton.bind(this, 'sortDesc')}
					/>
				</li>
				{filters}
				<li key="div-toggle"><divider/></li>
				<li>
					<button { ...this.toggleTerminalOptions }
						title="Toggle Terminal"
						onClick={this.toggleButtonState.bind(this, 'toggleTerminal')}
					/>
				</li>
				<li>
					<button { ...this.toggleCoverageOptions }
						title="Toggle Coverage"
						onClick={this.toggleButtonState.bind(this, 'toggleCoverage')}
					/>
				</li>
			</ul>
		)
	}
}
