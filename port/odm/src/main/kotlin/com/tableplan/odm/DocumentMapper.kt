package com.tableplan.odm

import org.bson.Document
import org.bson.types.Decimal128
import java.math.BigDecimal
import java.time.Instant
import java.util.Date
import java.util.concurrent.ConcurrentHashMap
import kotlin.reflect.KClass
import kotlin.reflect.KMutableProperty1
import kotlin.reflect.KParameter
import kotlin.reflect.KProperty1
import kotlin.reflect.full.createType
import kotlin.reflect.full.findAnnotation
import kotlin.reflect.full.memberProperties
import kotlin.reflect.full.primaryConstructor
import kotlin.reflect.jvm.isAccessible

class DocumentMapper {
    private data class PropertyBinding(
        val property: KProperty1<Any, Any?>,
        val persistedName: String,
    )

    private val bindings = ConcurrentHashMap<KClass<*>, List<PropertyBinding>>()

    fun toDocument(value: Any): Document {
        val document = Document()
        properties(value::class).forEach { binding ->
            binding.property.isAccessible = true
            val mapped = encode(binding.property.get(value))
            if (mapped != null) {
                document[binding.persistedName] = mapped
            }
        }
        return document
    }

    fun <T : Any> fromDocument(document: Document, type: KClass<T>): T {
        val constructor = requireNotNull(type.primaryConstructor) {
            "${type.qualifiedName} must have a primary constructor"
        }
        constructor.isAccessible = true
        val requiredParameters = constructor.parameters.filter { !it.isOptional && !it.type.isMarkedNullable }
        require(requiredParameters.isEmpty()) {
            "${type.qualifiedName} must have an empty/default primary constructor"
        }
        val instance = constructor.callBy(emptyMap())
        properties(type).forEach { binding ->
            if (!document.containsKey(binding.persistedName)) return@forEach
            @Suppress("UNCHECKED_CAST")
            val mutable = binding.property as? KMutableProperty1<Any, Any?> ?: return@forEach
            mutable.isAccessible = true
            mutable.set(instance, decode(document[binding.persistedName], mutable.returnType.classifier as? KClass<*>))
        }
        return instance
    }

    @Suppress("UNCHECKED_CAST")
    private fun properties(type: KClass<*>): List<PropertyBinding> =
        bindings.computeIfAbsent(type) {
            it.memberProperties
                .mapNotNull { property ->
                    val field = property.findAnnotation<Field>() ?: return@mapNotNull null
                    val name = field.name.ifBlank { property.name }
                    PropertyBinding(property as KProperty1<Any, Any?>, name)
                }
                .sortedBy(PropertyBinding::persistedName)
        }

    private fun encode(value: Any?): Any? =
        when (value) {
            null -> null
            is Instant -> Date.from(value)
            is BigDecimal -> Decimal128(value)
            is Embedded -> toDocument(value)
            is StringIdDocument -> toDocument(value)
            is Iterable<*> -> value.mapNotNull(::encode)
            is Map<*, *> -> Document(value.entries.associate { it.key.toString() to encode(it.value) })
            else -> value
        }

    private fun decode(value: Any?, target: KClass<*>?): Any? =
        when {
            value == null -> null
            target == Instant::class && value is Date -> value.toInstant()
            target == BigDecimal::class && value is Decimal128 -> value.bigDecimalValue()
            target == Int::class && value is Number -> value.toInt()
            target == Long::class && value is Number -> value.toLong()
            target == Double::class && value is Number -> value.toDouble()
            else -> value
        }
}

