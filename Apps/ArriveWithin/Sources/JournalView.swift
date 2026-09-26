import ArriveWithinDomain
import AVFAudio
import Observation
import SwiftUI
import UIKit

struct JournalView: View {
  let model: AppModel
  @Environment(\.locale) private var locale
  @State private var searchText = ""
  @State private var editor: JournalEditorContext?
  @State private var entryToDelete: JournalEntry?
  @State private var export: JournalExportPresentation?
  @State private var exportPendingCleanup: URL?

  private var filteredEntries: [JournalEntry] {
    JournalSearch.filter(
      model.journalEntries,
      query: searchText,
      locale: locale,
      timeZone: .current
    )
  }

  var body: some View {
    let visibleEntries = filteredEntries
    ScrollView {
      LazyVStack(alignment: .leading, spacing: AppTheme.Spacing.generous) {
        VStack(alignment: .leading, spacing: 6) {
          Text("journal.title")
            .font(.system(.largeTitle, design: .rounded, weight: .bold))
          Text("journal.subtitle")
            .font(.title3)
            .foregroundStyle(.secondary)
          Label("journal.privacy", systemImage: "lock")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.top, 4)
        }

        if let notice = model.journalNotice {
          JournalNoticeView(notice: notice)
        }

        if !model.journalConflicts.isEmpty {
          VStack(alignment: .leading, spacing: AppTheme.Spacing.standard) {
            Text("journal.conflict.title")
              .font(.title3.bold())
            Text("journal.conflict.body")
              .font(.footnote)
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
            ForEach(model.journalConflicts) { conflict in
              JournalReplicaConflictView(conflict: conflict) { variant in
                Task { _ = await model.resolveJournalConflict(conflict, keeping: variant) }
              }
            }
          }
          .quietCard()
          .accessibilityIdentifier("journal.replicaConflicts")
        }

        if model.journalEntries.isEmpty {
          JournalEmptyState {
            editor = .new(linkedPracticeEventID: nil)
          }
        } else if visibleEntries.isEmpty {
          ContentUnavailableView.search(text: searchText)
        } else {
          VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(visibleEntries.enumerated()), id: \.element.id) { index, entry in
              JournalEntryRow(
                entry: entry,
                edit: { editor = .existing(entry) },
                export: { prepareExport(entry) },
                delete: { entryToDelete = entry }
              )
              if index < visibleEntries.count - 1 { Divider() }
            }
          }
        }
      }
      .padding(AppTheme.Spacing.generous)
      .frame(maxWidth: AppTheme.maximumReadableWidth)
      .frame(maxWidth: .infinity)
    }
    .background(Color("LaunchBackground").ignoresSafeArea())
    .navigationTitle("journal.title")
    .navigationBarTitleDisplayMode(.inline)
    .searchable(text: $searchText, prompt: "journal.search")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button {
          editor = .new(linkedPracticeEventID: nil)
        } label: {
          Label("journal.new", systemImage: "square.and.pencil")
        }
        .accessibilityIdentifier("journal.new")
      }
    }
    .sheet(item: $editor) { context in
      JournalEditorView(model: model, context: context)
    }
    .sheet(item: $export, onDismiss: {
      if let url = exportPendingCleanup { model.discardOwnedExport(url) }
      exportPendingCleanup = nil
      export = nil
    }) { presentation in
      AppOwnedShareSheet(url: presentation.url) {
        model.discardOwnedExport(presentation.url)
        exportPendingCleanup = nil
        export = nil
      }
        .presentationDetents([.medium, .large])
    }
    .alert(
      "journal.delete.title",
      isPresented: Binding(
        get: { entryToDelete != nil },
        set: { if !$0 { entryToDelete = nil } }
      ),
      presenting: entryToDelete
    ) { entry in
      Button("common.cancel", role: .cancel) { entryToDelete = nil }
      Button("journal.delete.confirm", role: .destructive) {
        entryToDelete = nil
        Task { _ = await model.deleteJournalEntry(entry) }
      }
    } message: { _ in
      Text("journal.delete.body")
    }
    .onAppear {
      #if DEBUG
        if model.shouldPresentMarketingCaptureJournal {
          editor = .new(linkedPracticeEventID: nil)
        } else {
          presentPendingReflectionIfNeeded()
        }
      #else
        presentPendingReflectionIfNeeded()
      #endif
    }
    .onChange(of: model.pendingReflectionEventID) { _, _ in
      presentPendingReflectionIfNeeded()
    }
  }

  private func presentPendingReflectionIfNeeded() {
    guard let eventID = model.consumePendingReflectionEventID() else { return }
    editor = .new(linkedPracticeEventID: eventID)
  }

  private func prepareExport(_ entry: JournalEntry) {
    Task {
      if let url = await model.exportJournalEntry(entry) {
        exportPendingCleanup = url
        export = JournalExportPresentation(url: url)
      }
    }
  }
}

private struct JournalReplicaConflictView: View {
  let conflict: JournalReplicaConflict
  let keep: (JournalEntry) -> Void
  @Environment(\.locale) private var locale

  var body: some View {
    VStack(alignment: .leading, spacing: AppTheme.Spacing.standard) {
      ForEach(Array(conflict.variants.enumerated()), id: \.offset) { index, variant in
        VStack(alignment: .leading, spacing: 6) {
          Text(
            String.localizedStringWithFormat(
              AppLocalization.string("journal.conflict.version", locale: locale),
              index + 1
            )
          )
          .font(.caption.bold())
          Text(preview(variant))
            .lineLimit(5)
          Text(
            Date.FormatStyle(date: .abbreviated, time: .shortened, locale: locale)
              .format(variant.modifiedAt)
          )
            .font(.caption)
            .foregroundStyle(.secondary)
          Button("journal.conflict.keep") { keep(variant) }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("journal.conflict.keep.\(index)")
        }
        if index < conflict.variants.count - 1 { Divider() }
      }
    }
  }

  private func preview(_ entry: JournalEntry) -> String {
    if entry.isDeleted { return AppLocalization.string("journal.conflict.deleted", locale: locale) }
    let text = entry.text.trimmingCharacters(in: .whitespacesAndNewlines)
    if !text.isEmpty { return text }
    if let transcript = entry.transcript?.text, !transcript.isEmpty { return transcript }
    return AppLocalization.string("journal.voice.only", locale: locale)
  }
}

private struct JournalEntryRow: View {
  let entry: JournalEntry
  let edit: () -> Void
  let export: () -> Void
  let delete: () -> Void
  @Environment(\.locale) private var locale

  var body: some View {
    HStack(alignment: .top, spacing: AppTheme.Spacing.standard) {
      Button(action: edit) {
        VStack(alignment: .leading, spacing: 7) {
          Text(
            Date.FormatStyle(date: .abbreviated, time: .shortened, locale: locale)
              .format(entry.createdAt)
          )
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
          Text(preview)
            .font(.body)
            .foregroundStyle(.primary)
            .multilineTextAlignment(.leading)
            .lineLimit(4)
          HStack(spacing: 12) {
            if entry.linkedPracticeEventID != nil {
              Label("journal.linked", systemImage: "link")
            }
            if entry.audioAttachment != nil {
              Label("journal.voice", systemImage: "waveform")
            }
            if entry.transcript != nil {
              Label("journal.transcript", systemImage: "text.quote")
            }
          }
          .font(.caption)
          .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityIdentifier("journal.entry.\(entry.id.uuidString.lowercased())")

      Menu {
        Button("common.edit", systemImage: "pencil", action: edit)
        Button("journal.export", systemImage: "square.and.arrow.up", action: export)
        Button(role: .destructive, action: delete) {
          Label("common.delete", systemImage: "trash")
        }
      } label: {
        Image(systemName: "ellipsis")
          .frame(width: 36, height: 36)
      }
      .accessibilityLabel("common.more")
    }
    .padding(.vertical, AppTheme.Spacing.standard)
  }

  private var preview: String {
    let trimmed = entry.text.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? AppLocalization.string("journal.voice.only", locale: locale) : trimmed
  }
}

private struct JournalEmptyState: View {
  let create: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: AppTheme.Spacing.standard) {
      Image(systemName: "book.closed")
        .font(.system(size: 36, weight: .light))
        .foregroundStyle(.tint)
      Text("journal.empty.title")
        .font(.title2.bold())
      Text("journal.empty.body")
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
      Button("journal.new", action: create)
        .prominentActionButton()
        .accessibilityIdentifier("journal.empty.new")
    }
    .quietCard()
  }
}

private struct JournalNoticeView: View {
  let notice: AppModel.JournalNotice

  var body: some View {
    Label(message, systemImage: "exclamationmark.circle")
      .font(.footnote)
      .foregroundStyle(.secondary)
      .padding(AppTheme.Spacing.standard)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
  }

  private var message: LocalizedStringKey {
    switch notice {
    case .editConflict: "journal.notice.conflict"
    case .couldNotSave: "journal.notice.save"
    case .couldNotExport: "journal.notice.export"
    case .audioDeletionPending: "journal.notice.audio.delete"
    case .exportCleanupPending: "journal.notice.export.cleanup"
    case .microphoneDenied: "journal.notice.microphone"
    case .recordingFailed: "journal.notice.recording"
    case .recordingInterrupted: "journal.notice.interrupted"
    case .transcriptionUnavailable: "journal.notice.transcription"
    case .draftSaveFailed: "journal.notice.draft"
    }
  }
}

private struct JournalEditorContext: Identifiable {
  let id: UUID
  let entry: JournalEntry?
  let linkedPracticeEventID: UUID?

  static func new(linkedPracticeEventID: UUID?) -> Self {
    Self(id: UUID(), entry: nil, linkedPracticeEventID: linkedPracticeEventID)
  }

  static func existing(_ entry: JournalEntry) -> Self {
    Self(id: entry.id, entry: entry, linkedPracticeEventID: entry.linkedPracticeEventID)
  }

  var draftKey: String {
    if let entry { return "entry:\(entry.id.uuidString.lowercased())" }
    if let linkedPracticeEventID {
      return "practice:\(linkedPracticeEventID.uuidString.lowercased())"
    }
    return "new:unlinked"
  }
}

private struct JournalEditorView: View {
  let model: AppModel
  let context: JournalEditorContext
  @Environment(\.dismiss) private var dismiss
  @Environment(\.locale) private var locale
  @Environment(\.colorScheme) private var colorScheme
  @State private var text: String
  @State private var isSaving = false
  @State private var audioAttachment: JournalAudioAttachment?
  @State private var transcript: JournalTranscript?
  @State private var transcriptionState: JournalTranscriptionState
  @State private var isTranscribing = false
  @State private var didSave = false
  @State private var savedEntry: JournalEntry?
  @State private var showsDiscardConfirmation = false
  @State private var draftWasRestored = false
  @State private var draftIsSaved = false
  @State private var draftIsSaving = false
  @State private var draftSaveFailed = false
  @State private var journalEntryNeedsDraftCleanup = false
  @State private var didFlushCurrentDraftBeforeDismiss = false
  @State private var draftLoaded = false
  @State private var textChangedBeforeDraftLoaded = false
  @State private var isDiscarding = false
  @State private var draftSaveTask: Task<Void, Never>?
  @State private var previewPlayer = JournalVoicePreviewPlayer()
  @FocusState private var textIsFocused: Bool

  private var disablesAutocorrectionForUITest: Bool {
    #if DEBUG
      ProcessInfo.processInfo.arguments.contains("-ui-test-disable-autocorrection")
    #else
      false
    #endif
  }

  init(model: AppModel, context: JournalEditorContext) {
    self.model = model
    self.context = context
    _text = State(initialValue: context.entry?.text ?? "")
    _savedEntry = State(initialValue: context.entry)
    _audioAttachment = State(initialValue: context.entry?.audioAttachment)
    _transcript = State(initialValue: context.entry?.transcript)
    _transcriptionState = State(initialValue: context.entry?.transcriptionState ?? .notRequested)
  }

  private var hasUnsavedChanges: Bool {
    guard !didSave else { return false }
    return text != (savedEntry?.text ?? "")
      || displayedAttachment != savedEntry?.audioAttachment
      || transcript != savedEntry?.transcript
      || resolvedTranscriptionState != (savedEntry?.transcriptionState ?? .notRequested)
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Text("journal.prompt")
            .font(.title2.bold())
          TextEditor(text: $text)
            .frame(minHeight: 220)
            .focused($textIsFocused)
            .autocorrectionDisabled(disablesAutocorrectionForUITest)
            .accessibilityIdentifier("journal.editor.text")
            .disabled(isSaving || didSave)
        } footer: {
          VStack(alignment: .leading, spacing: 4) {
            Text("journal.editor.private")
            if draftSaveFailed {
              VStack(alignment: .leading, spacing: 8) {
                Label(
                  journalEntryNeedsDraftCleanup
                    ? "journal.draft.cleanupFailed"
                    : "journal.draft.saveFailed",
                  systemImage: "exclamationmark.triangle"
                )
                  .foregroundStyle(.orange)
                  .accessibilityIdentifier(
                    journalEntryNeedsDraftCleanup
                      ? "journal.draft.cleanupFailed"
                      : "journal.draft.saveFailed"
                  )
                Button(
                  journalEntryNeedsDraftCleanup
                    ? "journal.draft.retryCleanup"
                    : "journal.draft.retry"
                ) {
                  retryDraftPersistence()
                }
                .disabled(draftIsSaving)
                .accessibilityIdentifier(
                  journalEntryNeedsDraftCleanup
                    ? "journal.draft.retryCleanup"
                    : "journal.draft.retry"
                )
              }
            } else if draftIsSaving {
              Label("journal.draft.saving", systemImage: "arrow.triangle.2.circlepath")
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("journal.draft.saving")
            } else if draftWasRestored {
              Label("journal.draft.restored", systemImage: "arrow.uturn.backward")
                .accessibilityIdentifier("journal.draft.restored")
            } else if draftIsSaved {
              Label("journal.draft.saved", systemImage: "checkmark.circle")
                .accessibilityIdentifier("journal.draft.saved")
            }
          }
        }

        if context.linkedPracticeEventID != nil {
          Section {
            Label("journal.linked.detail", systemImage: "link")
              .foregroundStyle(.secondary)
          }
        }

        Section {
          voiceControls
            .disabled(isSaving || didSave)
        } header: {
          Text("journal.voice.section")
        } footer: {
          Text("journal.voice.private")
        }

        if let transcript {
          Section {
            Text(transcript.text)
              .textSelection(.enabled)
              .accessibilityIdentifier("journal.editor.transcript")
            Text("journal.transcript.on.device")
              .font(.caption)
              .foregroundStyle(.secondary)
          } header: {
            Text("journal.transcript.section")
          }
        }
      }
      .navigationTitle(savedEntry == nil ? "journal.new.title" : "journal.edit.title")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(didSave ? "common.done" : "common.cancel") {
            guard !isSaving, !isDiscarding else { return }
            if didSave {
              dismiss()
            } else if hasUnsavedChanges {
              textIsFocused = false
              showsDiscardConfirmation = true
            } else {
              flushDraftThenDismiss()
            }
          }
          .disabled(isSaving || isDiscarding)
          .accessibilityIdentifier("journal.editor.close")
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("common.save") {
            guard !isSaving, !isDiscarding else { return }
            isSaving = true
            Task {
              draftSaveTask?.cancel()
              let pendingDraftSave = draftSaveTask
              draftSaveTask = nil
              await pendingDraftSave?.value
              draftIsSaving = false
              #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("-ui-test-delay-journal-entry-save") {
                  try? await Task.sleep(for: .seconds(2))
                }
              #endif
              guard !Task.isCancelled else { return }
              let saved = await model.saveJournalEntry(
                existing: savedEntry,
                linkedPracticeEventID: context.linkedPracticeEventID,
                text: text,
                audioAttachment: displayedAttachment,
                transcript: transcript,
                transcriptionState: resolvedTranscriptionState
              )
              if let saved {
                savedEntry = saved
                didSave = true
                model.commitPendingJournalRecording()
                journalEntryNeedsDraftCleanup = true
                draftIsSaving = true
                let draftDeleted = await model.deleteJournalTextDraft(editorKey: context.draftKey)
                draftIsSaving = false
                isSaving = false
                if draftDeleted {
                  journalEntryNeedsDraftCleanup = false
                  draftSaveFailed = false
                  dismiss()
                } else {
                  draftSaveFailed = true
                }
              } else {
                isSaving = false
              }
            }
          }
          .disabled(
            isSaving || isDiscarding || didSave || isTranscribing
              || (text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && displayedAttachment == nil)
          )
          .accessibilityIdentifier("journal.editor.save")
        }
        ToolbarItemGroup(placement: .keyboard) {
          Spacer()
          Button("common.done") { textIsFocused = false }
            .accessibilityIdentifier("journal.editor.keyboard.done")
        }
      }
      .task {
        guard !draftLoaded else { return }
        #if DEBUG
          textIsFocused = !model.suppressesMarketingCaptureKeyboard && context.entry == nil
        #else
          textIsFocused = context.entry == nil
        #endif
        let draft = await model.loadJournalTextDraft(editorKey: context.draftKey)
        guard !Task.isCancelled, !isDiscarding else { return }
        draftSaveFailed = model.journalNotice == .draftSaveFailed
        if let draft,
          !textChangedBeforeDraftLoaded
        {
          if let entry = context.entry, draft.modifiedAt <= entry.modifiedAt {
            journalEntryNeedsDraftCleanup = true
            let deleted = await model.deleteJournalTextDraft(editorKey: context.draftKey)
            guard !Task.isCancelled else { return }
            if deleted {
              journalEntryNeedsDraftCleanup = false
              draftSaveFailed = false
            } else {
              draftSaveFailed = true
            }
          } else if draft.text != (context.entry?.text ?? "") {
            text = draft.text
            draftWasRestored = true
          } else {
            journalEntryNeedsDraftCleanup = true
            let deleted = await model.deleteJournalTextDraft(editorKey: context.draftKey)
            guard !Task.isCancelled else { return }
            if deleted {
              journalEntryNeedsDraftCleanup = false
              draftSaveFailed = false
            } else {
              draftSaveFailed = true
            }
          }
        }
        guard !Task.isCancelled else { return }
        draftLoaded = true
        #if DEBUG
          model.reportMarketingCaptureJournalEditorLoaded(
            prefilled: text == (model.marketingCaptureJournalText ?? ""),
            actualAppearance: colorScheme == .dark ? "dark" : "light"
          )
        #endif
        if hasUnsavedText { scheduleDraftSave() }
      }
      .interactiveDismissDisabled(
        isSaving || isDiscarding || ((hasUnsavedChanges || draftIsSaving) && !didSave)
      )
      .confirmationDialog(
        "journal.discard.title",
        isPresented: $showsDiscardConfirmation,
        titleVisibility: .visible
      ) {
        Button("journal.discard.action", role: .destructive) {
          guard !isSaving, !isDiscarding else { return }
          isDiscarding = true
          draftSaveTask?.cancel()
          let pendingDraftSave = draftSaveTask
          draftSaveTask = nil
          draftIsSaving = false
          Task {
            await pendingDraftSave?.value
            draftIsSaving = true
            if await model.deleteJournalTextDraft(editorKey: context.draftKey) {
              draftIsSaving = false
              draftSaveFailed = false
              dismiss()
            } else {
              draftIsSaving = false
              isDiscarding = false
              draftSaveFailed = true
            }
          }
        }
        Button("common.cancel", role: .cancel) {}
      } message: {
        Text("journal.discard.body")
      }
      .onDisappear {
        draftSaveTask?.cancel()
        if !didSave && !isSaving && !isDiscarding && !didFlushCurrentDraftBeforeDismiss && draftLoaded {
          let textToPersist = hasUnsavedText ? text : ""
          Task {
            await model.saveJournalTextDraft(
              editorKey: context.draftKey,
              linkedPracticeEventID: context.linkedPracticeEventID,
              text: textToPersist
            )
          }
        }
        previewPlayer.stop()
        if !didSave { model.discardPendingJournalRecording() }
      }
      .onChange(of: text) { _, _ in
        if !draftLoaded { textChangedBeforeDraftLoaded = true }
        if !didSave { journalEntryNeedsDraftCleanup = false }
        scheduleDraftSave()
      }
      .onChange(of: model.journalRecordingPhase) { _, phase in
        switch phase {
        case .ready(let attachment), .interrupted(let attachment?):
          audioAttachment = attachment
          transcript = nil
          transcriptionState = .notRequested
        default:
          break
        }
      }
    }
  }

  private var hasUnsavedText: Bool {
    !didSave
      && text != (savedEntry?.text ?? "")
      && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private func scheduleDraftSave() {
    guard draftLoaded, !didSave, !isDiscarding else { return }
    draftIsSaved = false
    draftSaveFailed = false
    draftIsSaving = true
    draftSaveTask?.cancel()
    let textToPersist = hasUnsavedText ? text : ""
    draftSaveTask = Task {
      do {
        try await Task.sleep(for: .milliseconds(400))
      } catch {
        return
      }
      guard !Task.isCancelled else { return }
      let saved = await model.saveJournalTextDraft(
        editorKey: context.draftKey,
        linkedPracticeEventID: context.linkedPracticeEventID,
        text: textToPersist
      )
      guard !Task.isCancelled else { return }
      draftIsSaved = saved && !textToPersist.isEmpty
      draftSaveFailed = !saved
      if saved { journalEntryNeedsDraftCleanup = false }
      draftIsSaving = false
    }
  }

  private func flushDraftThenDismiss() {
    guard !isSaving, !isDiscarding else { return }
    draftSaveTask?.cancel()
    let pendingDraftSave = draftSaveTask
    draftSaveTask = nil
    guard draftLoaded else {
      dismiss()
      return
    }
    didFlushCurrentDraftBeforeDismiss = false
    draftIsSaving = true
    Task {
      await pendingDraftSave?.value
      let saved = await model.saveJournalTextDraft(
        editorKey: context.draftKey,
        linkedPracticeEventID: context.linkedPracticeEventID,
        text: hasUnsavedText ? text : ""
      )
      draftIsSaving = false
      draftIsSaved = saved && hasUnsavedText
      draftSaveFailed = !saved
      if saved {
        didFlushCurrentDraftBeforeDismiss = true
        dismiss()
      }
    }
  }

  private func retryDraftPersistence() {
    guard !draftIsSaving else { return }
    draftIsSaving = true
    draftSaveFailed = false
    Task {
      if journalEntryNeedsDraftCleanup {
        let deleted = await model.deleteJournalTextDraft(editorKey: context.draftKey)
        draftIsSaving = false
        draftSaveFailed = !deleted
        if deleted {
          journalEntryNeedsDraftCleanup = false
          if didSave { dismiss() }
        }
      } else {
        let saved = await model.saveJournalTextDraft(
          editorKey: context.draftKey,
          linkedPracticeEventID: context.linkedPracticeEventID,
          text: hasUnsavedText ? text : ""
        )
        draftIsSaving = false
        draftIsSaved = saved && hasUnsavedText
        draftSaveFailed = !saved
      }
    }
  }

  @ViewBuilder
  private var voiceControls: some View {
    switch model.journalRecordingPhase {
    case .requestingPermission:
      HStack {
        ProgressView()
        Text("journal.voice.permission")
      }
    case .recording(let elapsedMilliseconds):
      HStack {
        Circle().fill(.red).frame(width: 9, height: 9)
        Text(durationLabel(elapsedMilliseconds))
          .font(.headline.monospacedDigit())
        Spacer()
        Button("journal.voice.stop") {
          if let attachment = model.finishJournalRecording() {
            audioAttachment = attachment
            transcript = nil
            transcriptionState = .notRequested
          }
        }
        .prominentActionButton()
        .accessibilityIdentifier("journal.voice.stop")
      }
    case .permissionDenied:
      Label("journal.voice.permission.denied", systemImage: "mic.slash")
        .foregroundStyle(.secondary)
      recordButton
    case .failed:
      Label("journal.voice.failed", systemImage: "exclamationmark.circle")
        .foregroundStyle(.secondary)
      recordButton
    case .idle, .ready, .interrupted:
      if let attachment = displayedAttachment {
        VStack(alignment: .leading, spacing: 12) {
          HStack {
            Label(durationLabel(attachment.durationMilliseconds), systemImage: "waveform")
            Spacer()
            Button {
              previewPlayer.toggle(url: model.journalAudioURL(for: attachment))
            } label: {
              Label(
                previewPlayer.isPlaying ? "journal.voice.pause" : "journal.voice.play",
                systemImage: previewPlayer.isPlaying ? "pause.fill" : "play.fill"
              )
            }
            .accessibilityIdentifier("journal.voice.playback")
          }

          HStack {
            Button("journal.voice.replace") {
              previewPlayer.stop()
              Task { await model.beginJournalRecording() }
            }
            Button("journal.voice.remove", role: .destructive) {
              previewPlayer.stop()
              model.discardPendingJournalRecording()
              audioAttachment = nil
              transcript = nil
              transcriptionState = .notRequested
            }
          }

          if transcript == nil {
            Button {
              transcribe(attachment)
            } label: {
              if isTranscribing {
                ProgressView()
              } else {
                Label("journal.transcribe", systemImage: "text.quote")
              }
            }
            .disabled(isTranscribing)
            .accessibilityIdentifier("journal.voice.transcribe")
          }

          if transcriptionState == .unavailable || transcriptionState == .failed {
            Text("journal.transcript.unavailable")
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
        }
      } else {
        recordButton
        Text("journal.voice.limit")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
    }
  }

  private var recordButton: some View {
    Button {
      previewPlayer.stop()
      Task { await model.beginJournalRecording() }
    } label: {
      Label("journal.voice.record", systemImage: "mic")
    }
    .accessibilityIdentifier("journal.voice.record")
  }

  private var displayedAttachment: JournalAudioAttachment? {
    switch model.journalRecordingPhase {
    case .ready(let attachment), .interrupted(let attachment?): attachment
    default: audioAttachment
    }
  }

  private var resolvedTranscriptionState: JournalTranscriptionState {
    transcript == nil ? transcriptionState : .complete
  }

  private func transcribe(_ attachment: JournalAudioAttachment) {
    isTranscribing = true
    transcriptionState = .transcribing
    let localeIdentifier = locale.language.languageCode?.identifier == "de" ? "de-DE" : "en-US"
    Task {
      let result = await model.transcribeJournalAudio(
        attachment,
        localeIdentifier: localeIdentifier
      )
      transcript = result
      transcriptionState = result == nil ? .unavailable : .complete
      isTranscribing = false
    }
  }

  private func durationLabel(_ milliseconds: Int64) -> String {
    let seconds = max(0, milliseconds / 1_000)
    return String(format: "%d:%02d", seconds / 60, seconds % 60)
  }
}

@MainActor
@Observable
private final class JournalVoicePreviewPlayer: NSObject, AVAudioPlayerDelegate {
  var isPlaying = false
  private var player: AVAudioPlayer?

  func toggle(url: URL?) {
    if isPlaying {
      stop()
      return
    }
    guard let url else { return }
    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playback, mode: .spokenAudio)
      try session.setActive(true)
      let player = try AVAudioPlayer(contentsOf: url)
      player.delegate = self
      guard player.prepareToPlay(), player.play() else {
        stop()
        return
      }
      self.player = player
      isPlaying = true
    } catch {
      stop()
    }
  }

  func stop() {
    player?.stop()
    player = nil
    isPlaying = false
    try? AVAudioSession.sharedInstance().setActive(
      false,
      options: .notifyOthersOnDeactivation
    )
  }

  nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    Task { @MainActor [weak self] in self?.stop() }
  }
}

private struct JournalExportPresentation: Identifiable {
  let url: URL
  var id: URL { url }
}
