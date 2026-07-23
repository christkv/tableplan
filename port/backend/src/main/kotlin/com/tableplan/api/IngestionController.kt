package com.tableplan.api

import com.tableplan.ingestion.IngestionService
import com.tableplan.ingestion.IngredientSelection
import com.tableplan.ingestion.RecipeDraft
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile

data class TextIngestionRequest(
    @field:NotBlank @field:Size(max = 102_400) val text: String,
    @field:Size(max = 240) val filename: String? = null,
)

data class PublishIngestionRequest(
    val visibility: String = "user_private",
    val draft: RecipeDraft? = null,
    @field:Size(max = 250) val ingredientSelections: List<IngredientSelection> = emptyList(),
)

data class UpdateRecipeRequest(
    val visibility: String,
    val draft: RecipeDraft,
)

@RestController
class IngestionController(
    private val ingestions: IngestionService,
) {
    @PostMapping("/api/v1/recipe-ingestions", consumes = [MediaType.APPLICATION_JSON_VALUE])
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun createText(
        @Valid @RequestBody request: TextIngestionRequest,
        authentication: Authentication,
    ) = ingestions.create(
        authentication.principal(),
        request.text.toByteArray(),
        request.filename,
        "text/plain",
        "paste",
    )

    @PostMapping("/api/v1/recipe-ingestions", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun upload(
        @RequestParam("file") file: MultipartFile,
        authentication: Authentication,
    ) = ingestions.create(
        authentication.principal(),
        file.bytes,
        file.originalFilename,
        file.contentType ?: "application/octet-stream",
        "upload",
    )

    @GetMapping("/api/v1/recipe-ingestions/{id}")
    fun get(@PathVariable id: String, authentication: Authentication) =
        ingestions.get(authentication.principal(), id)
            ?: throw ApiException(404, "ingestion_not_found", "Recipe ingestion not found.")

    @PostMapping("/api/v1/recipe-ingestions/{id}")
    @ResponseStatus(HttpStatus.CREATED)
    fun publish(
        @PathVariable id: String,
        @Valid @RequestBody request: PublishIngestionRequest,
        authentication: Authentication,
    ) = mapOf(
        "recipeId" to
            ingestions.publish(
                authentication.principal(),
                id,
                request.visibility,
                request.draft,
                request.ingredientSelections,
            ),
    )

    @PutMapping("/api/v1/recipes/{id}")
    fun update(
        @PathVariable id: String,
        @Valid @RequestBody request: UpdateRecipeRequest,
        authentication: Authentication,
    ) = ingestions.updateOwnedRecipe(authentication.principal(), id, request.draft, request.visibility)
}
