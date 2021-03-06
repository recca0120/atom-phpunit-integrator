/** @babel */
/** @jsx etch.dom */
/* global Promise atom document */

import etch from 'etch'
import {CompositeDisposable} from 'atom'
import {
	EtchFlexContainer,
	EtchFlexElement,
	EtchFlexSplitter,
	EtchTerminal,
	EtchMultiSelect,
	EtchSelect,
	EtchProgressBar } from 'colletch'

import {openInAtom} from '../util/php-unit-utils'
import PhpUnitCoverageView from './php-unit-coverage-view'
import PhpUnitReportView from './php-unit-report-view'
import PhpUnitButtonBar from './php-unit-button-bar'
import PhpUnitStatisticsView from './php-unit-statistics-view'

const FILE_PATH_EXPRESSION = /^(.*?)(((?:\/|[A-Z]:\\)[\w\\/_-]+\.[\w.]+)(?:(?: on line |:)(\d+))?)(.*)$/g

/**
 * Handles the main view for the package
 */
export default class PhpUnitIntegratorView
{
	/**
	 * Constructor
	 *
	 * @constructor
	 * @param {PhpUnitWorkspace} workspace - The package workspace
	 * @param {Array}            [state]    - The previous result of @see {@link getState}
	 */
	constructor (workspace, state = {}) {
		this.testRunner = workspace.getProjectTester()
		this.projectManager = workspace.getProjectManager()
		this.configuration = workspace.getPackageConfig()
		this.disposables = new CompositeDisposable()

		this.state = Object.assign({
			hasCoverage: false,
			hasTerminal: true,
			orientation: "vertical"
		}, state)

		this.buttonOptions = {
			cancelAll: {
				hidden: true
			},
			expandAll: {
				hidden: true
			},
			collapseAll: {
				hidden: true
			},
			sortAsc: {
				hidden: true
			},
			sortDesc: {
				hidden: true
			},
			runSuite: {
				hidden: false
			},
			runSelected: {
				disabled: true
			},
			toggleTerminal: {
				active: this.state.hasTerminal
			},
			toggleCoverage: {
				active: this.state.hasCoverage,
				hidden: true
			}
		}

		this.disposables.add(this.projectManager.onDidProjectsChange(projects => {
			this.buildProjectOptionList(projects)

			return Promise.all([
				this.clear(),
				etch.update(this)
			])
		}))

		this.disposables.add(this.projectManager.onDidProjectConfigChange(project => {
			if (project.getRoot() === this.selectedProject) {
				this.buildSuiteOptionList(project)

				return Promise.all([
					this.clear(),
					etch.update(this)
				])
			}
		}))

		etch.initialize(this)

		this.disposables.add(atom.commands.add('.php-unit-integrator .php-unit-output-view', {
			'core:copy': () => {
				this.refs.terminal.copySelection()
			},
			'php-unit-integrator:output-select-all': () => {
				this.refs.terminal.selectAll()
			}
		}))

		this.registerTestListeners()
	}

	/**
	 * Returns the current state of the instance as a JSON encodable object
	 *
	 * @return {Object} - The current state
	 */
	serialize () {
		return Object.assign(this.state, {
			deserializer: 'PhpUnitIntegratorView',
			container: this.refs.container.getState(),
		})
	}

	/**
	 * Re renders one or more components depending on the properties given
	 *
	 * @param  {Object}  props - The properties to be refreshed
	 *
	 * @return {Promise}       - Resolves when all have refreshed
	 */
	update (props) {
		const tasks = []

		if (props.activeProject && props.activeProject !== this.selectedProject) {
			this.selectedProject = props.activeProject

			tasks.push(Promise.all([
				this.updateProjectOptionList(),
				this.updateSuiteOptionList(),
				this.updateGroupOptionList(),
			]))
		}

		switch (props.state) {
			case 'test-begin':
				this.focusedElement = document.activeElement

				tasks.push(this.refs.report.update({pendingReport: true}))
				tasks.push(this.refs.statistics.clear())
				tasks.push(this.disableButtons(true))

				this.buttonOptions.expandAll.hidden = true
				this.buttonOptions.collapseAll.hidden = true
				this.buttonOptions.sortAsc.hidden = true
				this.buttonOptions.sortDesc.hidden = true
				delete this.buttonOptions.filterStates

				if (this.refs.terminal) {
					this.terminalReport = null
					tasks.push(this.refs.terminal.clear())
				}
				break;

			case 'test-progress':
				if (this.runningBatch) {
					tasks.push(this.updateProgress(this.runningQueue))
				}
				break

			case 'test-end':
				tasks.push(this.refs.report.update({pendingReport: false}))
				tasks.push(this.disableButtons(false))
				tasks.push(this.updateProgress(null))
				break;
		}

		if (null != props.testReport) {
			this.testReport = props.testReport

			this.buttonOptions.filterStates = props.testReport.getContainedStates()
			this.buttonOptions.expandAll.hidden = false
			this.buttonOptions.collapseAll.hidden = false
			this.buttonOptions.sortAsc.hidden = false

			tasks.push(this.refs.report.update({report: props.testReport}))
			tasks.push(this.refs.statistics.update({report: props.testReport}))
		}

		if (null != props.coverageReport && this.refs.coverage) {
			tasks.push(this.refs.coverage.update({report: props.coverageReport}))
		}

		if (props.orientation && props.orientation !== this.state.orientation) {
			this.state.orientation = props.orientation
			tasks.push(this.refs.container.update({orientation: this.state.orientation}))
			tasks.push(this.scheduleUpdate(() => {
				this.refs.paneHeader.classList.remove('vertical', 'horizontal')
				this.refs.paneHeader.classList.add(this.state.orientation)
			}))
		}

		tasks.push(this.refs.buttonBar.update(this.buttonOptions))

		return Promise.all(tasks).then(() => {
			if ('test-end' === props.state && this.focusedElement) {
				this.focusedElement.focus()
			}
		})
	}

	/**
	 * Destructor
	 */
	destroy () {
		if (this.disposables) {
			this.disposables.dispose()
		}
		// if (this.coverageMarkers) {
		// 	this.coverageMarkers.destroy()
		// }

		this.disposables = null
		this.testRunner = null
		this.projectManager = null
		// this.coverageMarkers = null

		etch.destroy(this)
	}

	/**
	 * Click handler for the clear all button
	 *
	 * @return {Promise} - Resolves when rendering is complete
	 */
	clear () {
		this.buttonOptions.cancelAll.hidden = true
		this.buttonOptions.runSelected.disabled = true
		this.buttonOptions.filterStates = null
		this.buttonOptions.expandAll.hidden = true
		this.buttonOptions.collapseAll.hidden = true
		this.buttonOptions.sortAsc.hidden = true
		this.buttonOptions.sortDesc.hidden = true

		const tasks = [
			this.refs.report.clear(),
			this.refs.buttonBar.update(this.buttonOptions),
			this.refs.statistics.clear()
		]

		if (this.refs.coverage) {
			tasks.push(this.refs.coverage.clear())
		}

		if (this.refs.terminal) {
			tasks.push(this.refs.terminal.clear())
		}

		return Promise.all(tasks)
	}

	/**
	 * Registers a URI which will open this view
	 *
	 * @return {String} - A unique URI
	 */
	getURI () {
		return 'php-unit-integrator'
	}

	/**
	 * Registers an icon to be used in the pane tab list
	 *
	 * @return {String} - An icon name
	 */
	getIconName () {
		return 'terminal'
	}

	/**
	 * Registers the title used in the pane tab list
	 *
	 * @return {String} - The title
	 */
	getTitle () {
		return 'PHPUnit'
	}

	/**
	 * Registers the default position within the panels
	 *
	 * @return {String} - The position
	 */
	getDefaultLocation () {
		return 'bottom'
	}

	/**
	 * Returns the DOM node to be inserted into the page
	 *
	 * @return {DomNode} - The element
	 */
	getElement () {
		return this.element
	}

	/**
	 * Returns the state of the code coverage toggle
	 *
	 * @return {Boolean}
	 */
	isCodeCoverageEnabled () {
		let enabled = false

		if (this.refs) {
			enabled = this.refs.codeCoverageToggle.checked
		}

		return enabled
	}

	/**
	 * Returns the state of the current file toggle
	 *
	 * @return {Boolean}
	 */
	isCurrentFileOnly () {
		let enabled = false

		if (this.refs) {
			enabled = this.refs.currentFileToggle.checked
		}

		return enabled
	}

	/**
	 * Attaches listeners to the main project tester
	 *
	 * @private
	 */
	registerTestListeners () {
		this.disposables.add(this.testRunner.onWillBeginBatchTest(({project, queue}) => {
			this.runningQueue = queue
			this.runningBatch = true

			return this.update({
				state: 'test-begin',
				activeProject: project.getRoot(),
			})
		}))

		this.disposables.add(this.testRunner.onDidCompleteBatchTest(({project}) => {
			return this.update({
				state: 'test-end',
				activeProject: project.getRoot(),
			}).then(() => {
				this.runningQueue = null
				this.runningBatch = false
			})
		}))

		this.disposables.add(this.testRunner.onDidBeginTest(({project, queue}) => {
			this.runningQueue = queue

			return this.update({
				state: this.runningBatch ? 'test-progress' : 'test-begin',
				activeProject: project.getRoot(),
				testReport: null,
				coverageReport: null,
			})
		}))

		this.disposables.add(this.testRunner.onDidCompleteTest(({project}) => {
			const coverage = this.isCodeCoverageEnabled()
			const testReport = project.getTestReport()
			let coverageReport

			if (coverage) {
				coverageReport = project.getCoverageReport()
			}

			return this.update({
				state: this.runningBatch ? 'test-progress' : 'test-end',
				activeProject: project.getRoot(),
				testReport,
				coverageReport,
			}).then(() => {
				if (!this.runningBatch) {
					this.runningQueue = null
				}
			})
		}))

		this.disposables.add(this.testRunner.onDidCancelTest(({project}) => {
			return this.update({
				state: 'test-end',
				activeProject: project.getRoot(),
				testReport: null,
				coverageReport: null
			}).then(() => {
				this.runningQueue = null
				this.runningBatch = false
			})
		}))

		this.disposables.add(this.testRunner.onTestCommandLine(({project, data}) => {
			if (!this.terminalReport) {
				if (this.refs.terminal) {
					this.refs.terminal.clear();
					this.refs.terminal.writeln(data + '\n')
				}

				return this.update({
					state: 'test-progress',
					activeProject: project.getRoot()
				})
			}
		}))

		this.disposables.add(this.testRunner.onTestOutputData(({project, data}) => {
			if (!this.terminalReport) {
				if (this.refs.terminal) {
					this.refs.terminal.write(data)
				}

				return this.update({
					state: 'test-progress',
					activeProject: project.getRoot()
				})
			}
		}))

		this.disposables.add(this.testRunner.onTestErrorData(({project, data}) => {
			if (!this.terminalReport) {
				if (this.refs.terminal) {
					this.refs.terminal.write(data)
				}

				return this.update({
					state: 'test-progress',
					activeProject: project.getRoot()
				})
			}
		}))

		this.disposables.add(this.testRunner.onClearAll(() => {
			return this.clear()
		}))
	}

	/**
	 * Adds a callback to the document update scheduler
	 *
	 * @private
	 * @param  {Function} cb - The callback to invoke
	 *
	 * @return {Promise}     - Resolves when rendered
	 */
	scheduleUpdate (cb) {
		atom.views.updateDocument(cb)

		return atom.views.getNextUpdatePromise()
	}

	/**
	 * Enables/disables controls during a running test
	 *
	 * @private
	 * @param  {Boolean} disable - Whether to enable or disable
	 *
	 * @return {Promise}         - Resolves when rendering complete
	 */
	disableButtons(disable) {
		return this.scheduleUpdate(() => {
			this.refs.suiteList.disable(disable)
			this.refs.groupList.disable(disable)

			if (this.refs.projectList) {
				this.refs.projectList.disable(disable)
			}

			if (disable) {
				this.refs.codeCoverageToggle.setAttribute('disabled', true)
			} else {
				this.refs.codeCoverageToggle.removeAttribute('disabled')
			}

			this.buttonOptions.cancelAll.hidden = !disable
			this.buttonOptions.runSuite.hidden = disable

			this.refs.buttonBar.update(this.buttonOptions)
		})
	}

	/**
	 * Updates/hides the progress bar for batch tests
	 *
	 * @param  {PhpUnitTestQueue} [queue] - The queue of tests
	 */
	updateProgress (queue = null) {
		if (queue) {
			return this.refs.batchProgressBar.update({
				total: queue.totalItemCount(),
				complete: queue.processedItemCount()
			})
		} else {
			return this.refs.batchProgressBar.update({
				total: 0
			})
		}
	}

	/**
	 * Creates a list of selectable projects
	 *
	 * @private
	 */
	buildProjectOptionList () {
		const options = []
		this.suiteOptions = []

		this.projectManager.getProjects().forEach(project => {
			const attributes = {}

			if (this.selectedProject == null || project.getRoot() === this.selectedProject) {
				attributes.selected = true

				this.selectedProject = project.getRoot()

				this.buildSuiteOptionList(project)
			}

			options.push(
				<span { ...attributes }
					key={ project.getRoot() }
				>
					{ project.name }
				</span>
			)
		})

		return options
	}

	/**
	 * Creates a list of test suites available in the project
	 *
	 * @private
	 */
	buildSuiteOptionList () {
		const project = this.projectManager.getProject(this.selectedProject)
		const active = project.getSelectedSuiteNames()

		const options = []

		project.getAvailableSuiteNames().forEach(name => {
			const attributes = {}

			if (-1 !== active.indexOf(name)) {
				attributes.selected = true
			}

			options.push(
				<span { ...attributes }
					key={ name }
				>
					{ name }
				</span>
			)
		})

		return options
	}

	/**
	 * Creates a list of test groups available in the project
	 *
	 * @private
	 */
	buildGroupOptionList () {
		const project = this.projectManager.getProject(this.selectedProject)
		const active = project.getSelectedGroupNames()

		const options = []

		project.getAvailableGroupNames().forEach(name => {
			const attributes = {}

			if (-1 !== active.indexOf(name)) {
				attributes.selected = true
			}

			options.push(
				<span { ...attributes }
					key={ name }
				>
					{ name }
				</span>
			)
		})

		return options
	}

	/**
	 * Renders the project select list with new children
	 *
	 * @private
	 * @return {Promise} [description]
	 */
	async updateProjectOptionList () {
		if (this.refs.projectList) {
			return this.refs.projectList.update(null, this.buildProjectOptionList())
		}

		return Promise.resolve()
	}

	/**
	 * Renders the test suite select component with new children
	 *
	 * @private
	 * @return {Promise}
	 */
	async updateSuiteOptionList () {
		return this.refs.suiteList.update(null, this.buildSuiteOptionList())
	}

	/**
	 * Renders the test group select component with new children
	 *
	 * @private
	 * @return {Promise}
	 */
	async updateGroupOptionList () {
		return this.refs.groupList.update(null, this.buildGroupOptionList())
	}

	/**
	 * Switches the suites according to the selected project
	 *
	 * @private
	 * @param {String} projectPath - The newly selected project
	 */
	onSelectProject (projectPath) {
		this.selectedProject = projectPath
		this.selectedSuites = []

		this.updateSuiteOptionList()
		this.updateGroupOptionList()
	}

	/**
	 * Click handler for the suite selection
	 *
	 * @private
	 * @param {Array<String>} suiteNames - The list of currently selected suites
	 */
	onSelectSuites (suiteNames) {
		const project = this.projectManager.getProject(this.selectedProject)

		this.testRunner.setSelectedSuiteNames(project, suiteNames)
	}

	/**
	 * Click handler for the group selection
	 *
	 * @private
	 * @param {Array<String>} groupNames - The list of currently selected groups
	 */
	onSelectGroups (groupNames) {
		const project = this.projectManager.getProject(this.selectedProject)

		project.setSelectedGroupNames(groupNames)
	}

	/**
	 * Toggles the 'run selected' button when cases have been selected
	 *
	 * @private
	 * @param  {Number} count - The number of test cases selected
	 *
	 * @return {Promise}      - Resolves when the buttons have been rendered
	 */
	onSelectCase (count) {
		const disable = 0 === count

		if (disable !== this.buttonOptions.runSelected.disabled) {
			this.buttonOptions.runSelected.disabled = disable

			return this.refs.buttonBar.update(this.buttonOptions)
		}
	}

	/**
	 * Click handler for the tree view
	 *
	 * @private
	 * @param  {AbstractTestReport} report - The report which was clicked
	 */
	onClickCase (report) {
		if (!report.isSuiteReport()) {
			report = this.testReport.getTestSuiteReport(report.getSuiteName())
		}

		if (this.terminalReport !== report) {
			this.terminalReport = report

			if (this.refs.terminal) {
				this.scheduleUpdate(() => {
					const result = report.getRawResult()

					this.refs.terminal.clear()
					this.refs.terminal.writeln(result.cmd + '\n')
					this.refs.terminal.write(result.data)
				})
			}
		}
	}

	/**
	 * Code Coverage toggle handler.
	 *
	 * @private
	 * @return {Promise} - Resolves when all cleared
	 */
	onToggleCoverage () {
		const coverage = this.isCodeCoverageEnabled()

		this.testRunner.enableCodeCoverage(coverage)
		this.buttonOptions.toggleCoverage.hidden = !coverage

		return etch.update(this)
	}

	/**
	 * Handler for the various button bar buttons
	 *
	 * @private
	 * @param  {Object}  event - The button event
	 *
	 * @return {Promise}       - Resolves when the related component has been rendered
	 */
	async onClickButton (event) {
		switch (event.button) {
			case 'cancelAll':
				return this.abortTest()
			case 'runSuite':
				return await this.runSuite()
			case 'runSelected':
				return this.runSuite(this.refs.report.getCheckedItems())
			case 'clearAll':
				return this.testRunner.clearAll()
			case 'sortAsc':
			case 'sortDesc':
				return this.refs.report.sort(event.button).then(() => {
					const toggle = event.button === 'sortAsc' ? 'sortDesc' : 'sortAsc'

					this.buttonOptions.sortDesc.hidden = true
					this.buttonOptions.sortAsc.hidden = true
					this.buttonOptions[toggle].hidden = false

					return this.refs.buttonBar.update(this.buttonOptions)
				})
			case 'toggleTerminal':
				this.state.hasTerminal = event.active
				return etch.update(this)
			case 'toggleCoverage':
				this.state.hasCoverage = event.active
				return etch.update(this)
			case 'filterPassed':
			case 'filterError':
			case 'filterWarning':
			case 'filterFailure':
			case 'filterSkipped':
				return this.refs.report.update({filter: event.states})
			case 'expandAll':
				return this.refs.report.update({expandAll: true})
			case 'collapseAll':
				return this.refs.report.update({collapseAll: true})
		}
	}

	/**
	 * Click handler for the run selected button
	 *
	 * @private
	 * @param  {Object} selected - A map of suites and methods to filter by
	 *
	 * @return {Promise}         - Resolves when test completed and results rendered
	 */
	async runSuite (selected = null) {
		return this.testRunner.runTestSuite({
			project: this.selectedProject,
			filter: selected
		})
	}

	/**
	 * Cancels all running and pending tests
	 */
	abortTest () {
		if (this.runningQueue) {
			this.runningQueue.cancel()
		}
	}

	/**
	 * Modifies lines in the terminal view to create clickable file links
	 *
	 * @private
	 * @param  {Object}  event      - The pre render event
	 * @param  {DomNode} event.line - The rendered line
	 */
	onPreRenderOutputLine (event) {
		const span = event.line.firstChild

		if (span) {
			const lineText = span.innerText
			const match = FILE_PATH_EXPRESSION.exec(lineText)

			if (match) {
				const leading = match[1]
				const middle = match[2]
				const trailing = match[5]

				const applyText = (node, text) => {
					while (node.nodeType != 3) {
						node = node.firstChild
					}
					node.nodeValue = text
				}

				const copy = span.cloneNode(true)
				const link = span.cloneNode(true)

				applyText(copy, leading)
				applyText(link, middle)
				applyText(span, trailing)

				link.classList.add('file-link')
				link.addEventListener('click', () => {
					openInAtom(match[3], match[4])
				})

				event.line.insertBefore(copy, span)
				event.line.insertBefore(link, span)
			}
		}
	}

	/**
	 * Generates the virtual DOM
	 *
	 * @private
	 * @return {VirtualDom} - Required by etch
	 */
	render () {
		let projectSelector = null
		let terminalView = null
		let coverageView = null

		const projectOptions = this.buildProjectOptionList()
		const suiteOptions = this.buildSuiteOptionList()
		const groupOptions = this.buildGroupOptionList()

		if (1 < projectOptions.length) {
			projectSelector = (
				<label>
					<span>Project:</span>
					<EtchSelect
						ref='projectList'
						className='form-control'
						onDidSelectionChange={ this.onSelectProject.bind(this) }
					>
						{ projectOptions }
					</EtchSelect>
				</label>
			)
		}

		if (this.state.hasTerminal) {
			terminalView = [<EtchFlexSplitter propagate={true}/>]
			terminalView.push(
				<EtchFlexElement key="term" flex={2}>
					<EtchTerminal enableInput={false} onPreRenderLine={this.onPreRenderOutputLine.bind(this)} className="php-unit-output-view" ref="terminal"/>
				</EtchFlexElement>
			)
		}

		if (this.state.hasCoverage && !this.buttonOptions.toggleCoverage.hidden) {
			const project = this.projectManager.getProject(this.selectedProject)

			coverageView = [<EtchFlexSplitter propagate={true}/>]
			coverageView.push(
				<EtchFlexElement key="coverage" flex={1}>
					<PhpUnitCoverageView ref="coverage" report={project ? project.getCoverageReport() : null}/>
				</EtchFlexElement>
			)
		}

		return (
			<div className="php-unit-integrator">
				<div ref="paneHeader" className={"php-unit-pane-header " + this.state.orientation }>

					{projectSelector}

					<label>
						<span>Suites:</span>
						<EtchMultiSelect ref="suiteList" onDidSelectionChange={ this.onSelectSuites.bind(this) }>
							{ suiteOptions }
						</EtchMultiSelect>
					</label>

					<label>
						<span>Groups:</span>
						<EtchMultiSelect ref="groupList" onDidSelectionChange={ this.onSelectGroups.bind(this) }>
							{ groupOptions }
						</EtchMultiSelect>
					</label>

					<label>
						<span>Code Coverage:</span>
						<input checked={false} onClick={this.onToggleCoverage.bind(this)} ref="codeCoverageToggle" type="checkbox" className="input-toggle"/>
					</label>

					<label style={{ display: 'none' }}>
						<span>Current File:</span>
						<input ref="currentFileToggle" type="checkbox" className="input-toggle"/>
					</label>
				</div>

				<div className="php-unit-pane-content">
					<PhpUnitButtonBar { ... this.buttonOptions }
						ref="buttonBar"
						onClick={this.onClickButton.bind(this)}
					/>

					<EtchFlexContainer ref="container" state={this.state && this.state.container} orientation={ this.state.orientation }>

						<EtchFlexElement flex={1}>
							<div className="php-unit-report-panel">
								<PhpUnitReportView onDidClick={this.onClickCase.bind(this)} onDidSelect={this.onSelectCase.bind(this)} ref="report"/>
								<PhpUnitStatisticsView ref="statistics" />
								<EtchProgressBar ref="batchProgressBar" className="php-unit-batch-progress" label="" />
							</div>
						</EtchFlexElement>

						{ terminalView }
						{ coverageView }
					</EtchFlexContainer>
				</div>
			</div>
		)
	}
}
