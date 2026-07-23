package com.tableplan.api

import com.tableplan.export.ExportDocument
import com.tableplan.export.ExportService
import org.springframework.http.CacheControl
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@RestController
class ExportController(
    private val exports: ExportService,
) {
    @GetMapping("/api/v1/recipes/{id}/pdf", produces = [MediaType.APPLICATION_PDF_VALUE])
    fun recipe(
        @PathVariable id: String,
        @RequestParam(defaultValue = "a4") paper: String,
        authentication: Authentication,
    ) = response(exports.recipe(authentication.principal(), id, paper))

    @GetMapping("/api/v1/meal-plans/{id}/pdf", produces = [MediaType.APPLICATION_PDF_VALUE])
    fun plan(
        @PathVariable id: String,
        @RequestParam(defaultValue = "a4") paper: String,
        authentication: Authentication,
    ) = response(exports.plan(authentication.principal(), id, paper))

    @GetMapping("/api/v1/shopping-lists/{id}/pdf", produces = [MediaType.APPLICATION_PDF_VALUE])
    fun shopping(
        @PathVariable id: String,
        @RequestParam(defaultValue = "a4") paper: String,
        authentication: Authentication,
    ) = response(exports.shopping(authentication.principal(), id, paper))

    @GetMapping("/api/v1/meal-plans/{id}/combined.pdf", produces = [MediaType.APPLICATION_PDF_VALUE])
    fun combined(
        @PathVariable id: String,
        @RequestParam shoppingListId: String,
        @RequestParam(defaultValue = "a4") paper: String,
        authentication: Authentication,
    ) = response(exports.combined(authentication.principal(), id, shoppingListId, paper))

    private fun response(document: ExportDocument): ResponseEntity<ByteArray> =
        ResponseEntity.ok()
            .contentType(MediaType.APPLICATION_PDF)
            .cacheControl(CacheControl.noStore())
            .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"${document.filename}\"")
            .header("X-Content-Type-Options", "nosniff")
            .body(document.bytes)
}
